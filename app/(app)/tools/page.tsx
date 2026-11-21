"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import { AvailabilityBadge, Bookings } from "@/components/Availability";
import { useMe } from "@/components/AppShell";
import { RequestForm } from "@/components/RequestForm";
import { Button, Card, EmptyState, ErrorText, PageHeader, Skeleton, TrustedBadge } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, type Category } from "@/convex/lib/validators";
import { categoryLabel, conditionLabel } from "@/lib/format";
import { useRun } from "@/lib/useRun";

type Tool = FunctionReturnType<typeof api.tools.list>[number];

export default function ToolsPage() {
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const tools = useQuery(api.tools.list, { category });

  return (
    <>
      <PageHeader
        title="All tools"
        subtitle="Everything your neighbours are happy to lend."
        action={
          <Link href="/listings?new=1">
            <Button>+ List a tool</Button>
          </Link>
        }
      />
      <div className="mb-8 flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Filter by category">
        <FilterChip active={!category} onClick={() => setCategory(undefined)}>
          All
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c.value} active={category === c.value} onClick={() => setCategory(c.value)}>
            {c.label}
          </FilterChip>
        ))}
      </div>

      {tools === undefined ? (
        <Skeleton />
      ) : tools.length === 0 ? (
        <EmptyState>No tools in this category yet.</EmptyState>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard key={tool._id} tool={tool} />
          ))}
        </div>
      )}
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`border-b py-0.5 text-sm transition-colors ${
        active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const me = useMe();
  const [requesting, setRequesting] = useState(false);
  const [sent, setSent] = useState(false);
  const remove = useMutation(api.tools.remove);
  const { run, pending, error } = useRun();

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
            {categoryLabel(tool.category)} · {conditionLabel(tool.condition)}
          </p>
          <h3 className="mt-1.5 font-display text-3xl leading-tight text-ink">{tool.name}</h3>
        </div>
        <AvailabilityBadge availability={tool.availability} />
      </div>
      {tool.description && <p className="text-sm leading-relaxed text-ink-soft">{tool.description}</p>}
      <Bookings bookings={tool.bookings} />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          {tool.isMine ? <span className="italic">Your listing</span> : <>Lent by {tool.owner.displayName}</>}
          {tool.owner.trustedLender && <TrustedBadge />}
        </p>
        <div className="flex gap-2">
          {me.role === "admin" && (
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (confirm(`Remove "${tool.name}" from LendLoop? Pending requests will be cancelled.`)) {
                  void run(() => remove({ toolId: tool._id }));
                }
              }}
            >
              Remove
            </Button>
          )}
          {!tool.isMine && !requesting && (
            <Button variant={sent ? "secondary" : "primary"} onClick={() => setRequesting(true)}>
              {sent ? "Request sent ✓" : "Request to borrow"}
            </Button>
          )}
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      {requesting && (
        <RequestForm
          toolId={tool._id}
          onDone={(ok) => {
            setRequesting(false);
            if (ok) setSent(true);
          }}
        />
      )}
    </Card>
  );
}
