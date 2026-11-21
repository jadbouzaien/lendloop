"use client";

import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { Skeleton } from "./ui";

type Me = NonNullable<FunctionReturnType<typeof api.users.me>>;
const MeContext = createContext<Me | null>(null);

/** The signed-in user's profile (role, trusted flag). Only valid inside AppShell. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe must be used inside <AppShell>");
  return me;
}

const NAV = [
  { href: "/tools", label: "All tools" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming requests" },
];

/**
 * Waits for Convex to accept the Clerk token, makes sure the local profile
 * exists, then renders the app with navigation.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const { user } = useUser();
  const firstName = user?.firstName ?? undefined;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = useQuery(api.users.me, ready ? {} : "skip");
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    ensureCurrent({ firstName })
      .then(() => setReady(true))
      .catch((e) => setError(errorMessage(e)));
  }, [isAuthenticated, user, firstName, ensureCurrent]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!isLoading && !isAuthenticated) {
    return (
      <p className="text-sm text-ink-soft">
        Could not authenticate with the backend. Check the Clerk ↔ Convex configuration (see README).
      </p>
    );
  }
  if (!me) return <Skeleton />;

  const links = me.role === "admin" ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;

  return (
    <MeContext.Provider value={me}>
      <nav className="mb-12 flex gap-7 overflow-x-auto">
        {links.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b py-1 text-sm transition-colors ${
                active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </MeContext.Provider>
  );
}
