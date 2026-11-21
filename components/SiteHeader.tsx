import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "./Logo";

export function SiteHeader() {
  return (
    <header className="mx-auto w-full max-w-5xl px-5 sm:px-8">
      <div className="flex h-20 items-center justify-between border-b border-line">
        <Link href="/" aria-label="LendLoop home">
          <Logo />
        </Link>
        <Suspense fallback={<div className="h-8 w-20" />}>
          <HeaderAuth />
        </Suspense>
      </div>
    </header>
  );
}

/** Auth-dependent part of the header; dynamic, so it streams in under Suspense. */
function HeaderAuth() {
  return (
    <div className="flex items-center gap-5">
      <Show when="signed-out">
        <SignInButton mode="modal" forceRedirectUrl="/tools">
          <button className="text-sm font-medium text-ink underline-offset-4 hover:underline">Sign in</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link href="/tools" className="text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline">
          Open the board
        </Link>
        <UserButton />
      </Show>
    </div>
  );
}
