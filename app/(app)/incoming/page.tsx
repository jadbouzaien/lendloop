"use client";

import { useQuery } from "convex/react";
import { LoanSection } from "@/components/LoanCard";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { api } from "@/convex/_generated/api";

export default function IncomingRequestsPage() {
  const loans = useQuery(api.loans.incoming);

  return (
    <>
      <PageHeader title="Incoming requests" subtitle="Neighbours who want to borrow your tools." />
      {loans === undefined ? (
        <Skeleton />
      ) : loans.length === 0 ? (
        <EmptyState>No requests for your tools yet.</EmptyState>
      ) : (
        <div className="space-y-8">
          <LoanSection
            title="Needs your answer"
            perspective="lender"
            loans={loans.filter((l) => l.status === "requested")}
            empty="You're all caught up."
          />
          <LoanSection title="Lent out" perspective="lender" loans={loans.filter((l) => l.status === "approved")} />
          <LoanSection
            title="History"
            perspective="lender"
            loans={loans.filter((l) => l.status !== "approved" && l.status !== "requested")}
          />
        </div>
      )}
    </>
  );
}
