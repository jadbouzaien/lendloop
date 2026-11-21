"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AvailabilityBadge, Bookings } from "@/components/Availability";
import { ToolForm } from "@/components/ToolForm";
import { Button, Card, EmptyState, ErrorText, PageHeader, Skeleton } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { categoryLabel, conditionLabel } from "@/lib/format";
import { useRun } from "@/lib/useRun";

type MyTool = FunctionReturnType<typeof api.tools.mine>[number];

export default function ListingsPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Listings />
    </Suspense>
  );
}

function Listings() {
  const tools = useQuery(api.tools.mine);
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get("new") === "1");

  return (
    <>
      <PageHeader
        title="My listings"
        subtitle="Tools you lend to the neighbourhood."
        action={!creating && <Button onClick={() => setCreating(true)}>+ List a tool</Button>}
      />
      {creating && (
        <Card className="mb-6">
          <h2 className="mb-5 font-display text-3xl text-ink">New listing</h2>
          <ToolForm onDone={() => setCreating(false)} />
        </Card>
      )}
      {tools === undefined ? (
        <Skeleton />
      ) : tools.length === 0 ? (
        !creating && <EmptyState>You haven&apos;t listed anything yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) => (
            <ListingRow key={tool._id} tool={tool} />
          ))}
        </div>
      )}
    </>
  );
}

function ListingRow({ tool }: { tool: MyTool }) {
  const [editing, setEditing] = useState(false);
  const remove = useMutation(api.tools.remove);
  const { run, pending, error } = useRun();

  if (editing) {
    return (
      <Card>
        <ToolForm
          toolId={tool._id}
          initial={{ name: tool.name, category: tool.category, condition: tool.condition, description: tool.description }}
          onDone={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-2xl leading-tight text-ink">{tool.name}</h3>
            <AvailabilityBadge availability={tool.availability} />
          </div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
            {categoryLabel(tool.category)} · {conditionLabel(tool.condition)}
          </p>
          {tool.description && <p className="text-sm text-ink-soft">{tool.description}</p>}
          <Bookings bookings={tool.bookings} />
          {tool.pendingRequests > 0 && (
            <Link href="/incoming" className="text-sm font-medium text-accent underline-offset-4 hover:underline">
              {tool.pendingRequests} pending request{tool.pendingRequests > 1 ? "s" : ""} →
            </Link>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete "${tool.name}"? Pending requests will be cancelled.`)) {
                void run(() => remove({ toolId: tool._id }));
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
