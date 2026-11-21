"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { LoanSection } from "@/components/LoanCard";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { api } from "@/convex/_generated/api";

export default function MyRequestsPage() {
  const loans = useQuery(api.loans.myRequests);

  return (
    <>
      <PageHeader title="My requests" subtitle="Things you asked to borrow." />
      {loans === undefined ? (
        <Skeleton />
      ) : loans.length === 0 ? (
        <EmptyState>
          No requests yet. <Link href="/tools" className="font-medium text-ink underline underline-offset-4">Browse tools →</Link>
        </EmptyState>
      ) : (
        <div className="space-y-8">
          <LoanSection title="Borrowing now" perspective="borrower" loans={loans.filter((l) => l.status === "approved")} />
          <LoanSection title="Waiting for an answer" perspective="borrower" loans={loans.filter((l) => l.status === "requested")} />
          <LoanSection
            title="History"
            perspective="borrower"
            loans={loans.filter((l) => l.status !== "approved" && l.status !== "requested")}
          />
        </div>
      )}
    </>
  );
}
