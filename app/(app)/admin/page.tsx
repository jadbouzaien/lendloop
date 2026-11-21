"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useMe } from "@/components/AppShell";
import { LoanSection } from "@/components/LoanCard";
import { Badge, Button, Card, ErrorText, PageHeader, SectionTitle, Skeleton, TrustedBadge } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { AutomationIssue } from "@/convex/admin";
import { timeAgo } from "@/lib/format";
import { useRun } from "@/lib/useRun";

type Overview = FunctionReturnType<typeof api.admin.overview>;

export default function AdminPage() {
  const me = useMe();
  // The UI check is cosmetic; admin.overview itself rejects non-admins.
  if (me.role !== "admin") return <p className="text-sm text-ink-soft">This page is for admins.</p>;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const data = useQuery(api.admin.overview);
  if (data === undefined) return <Skeleton />;

  return (
    <>
      <PageHeader
        title="Admin"
        subtitle="Moderate listings, review all loans and keep an eye on automations."
        action={
          <Link href="/tools" className="text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline">
            Remove listings from “All tools” →
          </Link>
        }
      />
      <div className="space-y-14">
        <AutomationHealth issues={data.issues} />
        <Members users={data.users} />
        <LoanSection title="All loans" perspective="admin" loans={data.loans} empty="No loans yet." />
      </div>
    </>
  );
}

const STAGE_LABEL: Record<AutomationIssue["stage"], string> = {
  "convex-to-n8n": "Convex → n8n",
  "n8n-to-discord": "n8n → Discord",
};

function AutomationHealth({ issues }: { issues: AutomationIssue[] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <SectionTitle>Automation health</SectionTitle>
        {issues.length > 0 && (
          <span className="text-xs text-danger">
            {issues.length} failed notification{issues.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {issues.length === 0 ? (
        <Card className="text-sm text-ink-soft">
          <Badge tone="green">All good</Badge>
          <p className="mt-2">Every notification and reminder reached Discord. Failures will show up here.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {issues.map((issue) => (
            <IssueRow key={issue._id} issue={issue} />
          ))}
        </Card>
      )}
    </section>
  );
}

function IssueRow({ issue }: { issue: AutomationIssue }) {
  const retry = useMutation(api.admin.retryDelivery);
  const { run, pending, error } = useRun();
  const deliveryId = issue.retryDeliveryId;

  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone="red">Failed</Badge>
          <span className="font-medium text-ink">{issue.title}</span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted">{STAGE_LABEL[issue.stage]}</span>
        </div>
        <p className="text-sm text-ink-soft">{issue.about}</p>
        <p className="text-sm text-ink-soft">
          <span className="text-muted">Likely cause:</span> {issue.hint}
        </p>
        <p className="break-words font-mono text-xs text-muted">
          {issue.error} · {issue.attempts} attempt{issue.attempts > 1 ? "s" : ""} · {timeAgo(issue.at)}
        </p>
        <ErrorText>{error}</ErrorText>
      </div>
      {deliveryId ? (
        <Button variant="secondary" disabled={pending} onClick={() => run(() => retry({ deliveryId }))}>
          {pending ? "Re-sending…" : "Re-send"}
        </Button>
      ) : (
        issue.note && <p className="max-w-48 text-xs text-muted sm:text-right">{issue.note}</p>
      )}
    </div>
  );
}

function Members({ users }: { users: Overview["users"] }) {
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const { run, pending, error } = useRun();

  return (
    <section className="space-y-3">
      <SectionTitle>
        Members <span className="text-muted/70">· {users.length}</span>
      </SectionTitle>
      <Card className="divide-y divide-line p-0">
        {users.map((u) => (
          <div key={u._id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
            <span className="flex items-center gap-3 text-sm">
              <span className="font-medium text-ink">{u.displayName}</span>
              {u.role === "admin" && <Badge>admin</Badge>}
              {u.trustedLender && <TrustedBadge />}
              <span className="text-xs text-muted">
                {u.listings} listing{u.listings === 1 ? "" : "s"}
              </span>
            </span>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => setTrusted({ userId: u._id, trusted: !u.trustedLender }))}
            >
              {u.trustedLender ? "Remove Trusted Lender" : "Mark Trusted Lender"}
            </Button>
          </div>
        ))}
      </Card>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
