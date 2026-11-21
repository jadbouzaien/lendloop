"use client";

import { useMutation } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { PresentedLoan } from "@/convex/loans";
import { formatRange, timeAgo } from "@/lib/format";
import { useRun } from "@/lib/useRun";
import { ActivityList } from "./ActivityList";
import { Badge, Button, Card, ErrorText, SectionTitle, TrustedBadge } from "./ui";

export function LoanStatusBadge({ loan }: { loan: PresentedLoan }) {
  if (loan.overdue) return <Badge tone="red">Overdue</Badge>;
  switch (loan.status) {
    case "requested":
      return <Badge tone="amber">Pending</Badge>;
    case "approved":
      return <Badge tone="green">Approved</Badge>;
    case "returned":
      return <Badge tone="stone">Returned</Badge>;
    case "declined":
      return <Badge tone="stone">Declined</Badge>;
    case "cancelled":
      return <Badge tone="stone">Cancelled</Badge>;
  }
}

type Perspective = "borrower" | "lender" | "admin";

/** One loan, with the actions the viewer is allowed to take (re-checked server-side). */
export function LoanCard({ loan, perspective }: { loan: PresentedLoan; perspective: Perspective }) {
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);
  const { run, pending, error } = useRun();

  let who: ReactNode;
  if (perspective === "borrower") {
    who = (
      <>
        from <span className="text-ink">{loan.lender.displayName}</span>{" "}
        {loan.lender.trustedLender && <TrustedBadge />}
      </>
    );
  } else if (perspective === "lender") {
    who = (
      <>
        requested by <span className="text-ink">{loan.borrower.displayName}</span>
      </>
    );
  } else {
    who = (
      <>
        {loan.borrower.displayName} borrows from {loan.lender.displayName}
      </>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-2xl leading-tight text-ink">{loan.toolName}</h3>
            <LoanStatusBadge loan={loan} />
          </div>
          <p className="text-sm text-ink-soft">{who}</p>
          <p className="text-sm text-ink">{formatRange(loan.startDate, loan.endDate)}</p>
          {loan.message && perspective !== "admin" && (
            <p className="font-display text-lg italic text-ink-soft">“{loan.message}”</p>
          )}
          <p className="text-xs text-muted">Requested {timeAgo(loan._creationTime)}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {perspective === "lender" && loan.status === "requested" && (
            <>
              <Button disabled={pending} onClick={() => run(() => approve({ loanId: loan._id }))}>
                Approve
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => run(() => decline({ loanId: loan._id }))}>
                Decline
              </Button>
            </>
          )}
          {perspective === "lender" && loan.status === "approved" && (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => markReturned({ loanId: loan._id }))}
            >
              Mark returned
            </Button>
          )}
          {perspective === "borrower" && loan.status === "requested" && (
            <Button variant="ghost" disabled={pending} onClick={() => run(() => cancel({ loanId: loan._id }))}>
              Withdraw
            </Button>
          )}
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <ActivityList items={loan.activity} />
    </Card>
  );
}

export function LoanSection({
  title,
  loans,
  perspective,
  empty,
}: {
  title: string;
  loans: PresentedLoan[];
  perspective: Perspective;
  empty?: string;
}) {
  if (loans.length === 0 && !empty) return null;
  return (
    <section className="space-y-3">
      <SectionTitle>
        {title} <span className="text-muted/70">· {loans.length}</span>
      </SectionTitle>
      {loans.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        loans.map((loan) => <LoanCard key={loan._id} loan={loan} perspective={perspective} />)
      )}
    </section>
  );
}
