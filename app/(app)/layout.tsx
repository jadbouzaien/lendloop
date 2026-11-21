import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui";

/**
 * Every page under (app) requires a session. This check is for UX (send
 * signed-out visitors home); data access is enforced again in Convex.
 */
async function RequireSignIn({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/");
  return <AppShell>{children}</AppShell>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Skeleton />}>
      <RequireSignIn>{children}</RequireSignIn>
    </Suspense>
  );
}
