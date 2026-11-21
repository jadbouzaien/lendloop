import { Show, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import { PublicToolList } from "@/components/PublicToolList";
import { SectionTitle } from "@/components/ui";

const ctaClass =
  "inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink/85";

export default function HomePage() {
  return (
    <div className="space-y-24">
      <section className="pt-10 sm:pt-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">A neighbourhood lending board</p>
        <h1 className="mt-6 font-display text-6xl leading-[0.95] tracking-tight text-ink sm:text-8xl">
          Borrow what you need.
          <br />
          <em className="text-ink-soft">Lend what you don&apos;t.</em>
        </h1>
        <div className="mt-10 grid gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
          <p className="max-w-md text-base leading-relaxed text-ink-soft">
            Drills, ladders, tents, pasta machines. List what sits in your garage, borrow for a few days, and get a
            gentle nudge when it&apos;s time to bring it back.
          </p>
          <div className="min-h-12">
            <Suspense>
              <HeroCta />
            </Suspense>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <SectionTitle>Available right now</SectionTitle>
        </div>
        <PublicToolList />
      </section>
    </div>
  );
}

function HeroCta() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal" forceRedirectUrl="/tools">
          <button className={ctaClass}>Sign in to lend or borrow →</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link href="/tools" className={ctaClass}>
          Go to the board →
        </Link>
      </Show>
    </>
  );
}
