import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { eventLabel, parseDetail } from "./describe";

export type ActivityItem = {
  kind: "notification" | "reminder";
  status: "claimed" | "sent" | "failed" | "pending";
  detail?: string;
  at: number;
};

/**
 * Recent automation activity for a loan, merged from n8n write-backs
 * (automationEvents) and undelivered outbox rows (webhookDeliveries).
 */
export async function loanActivity(
  ctx: QueryCtx,
  loanId: Id<"loans">,
  limit = 5,
): Promise<ActivityItem[]> {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .take(limit);
  const deliveries = await ctx.db
    .query("webhookDeliveries")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .take(limit);

  const items: ActivityItem[] = events.map((e) => {
    const parsed = parseDetail(e.kind, e.status, e.detail);
    const parts = [
      parsed.label,
      parsed.recipient && `to the ${parsed.recipient}`,
      parsed.error && `error: ${parsed.error}`,
    ].filter(Boolean);
    return { kind: e.kind, status: e.status, detail: parts.join(" · ") || undefined, at: e.updatedAt };
  });
  for (const d of deliveries) {
    // Delivered rows are represented by n8n's own write-back above.
    if (d.status === "delivered") continue;
    items.push({
      kind: "notification",
      status: d.status === "failed" ? "failed" : "pending",
      detail:
        d.status === "failed"
          ? `${eventLabel(d.eventType)} · could not reach n8n`
          : `${eventLabel(d.eventType)} · queued`,
      at: d._creationTime,
    });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}
