"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/lib/format";
import { EmptyState, Skeleton } from "./ui";

/** Read-only, unauthenticated list: name and category only. */
export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic);
  if (tools === undefined) return <Skeleton rows={2} />;
  if (tools.length === 0) return <EmptyState>No tools listed yet. Be the first to lend one.</EmptyState>;

  return (
    <ul className="grid gap-x-10 sm:grid-cols-2">
      {tools.map((tool, i) => (
        <li key={tool._id} className="flex items-baseline gap-4 border-b border-line py-4">
          <span className="w-6 font-mono text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</span>
          <span className="flex-1 font-display text-2xl leading-tight text-ink">{tool.name}</span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted">{categoryLabel(tool.category)}</span>
        </li>
      ))}
    </ul>
  );
}
