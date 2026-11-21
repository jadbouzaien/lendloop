import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { daysBetween } from "./lib/dates";
import { automationKindValidator, automationStatusValidator } from "./lib/validators";

/** A "claimed" event older than this is considered abandoned and may be re-claimed. */
export const CLAIM_TTL_MS = 10 * 60 * 1000;

export function reminderKey(loanId: string, date: string) {
  return `reminder:${loanId}:${date}`;
}

/**
 * Approved loans whose end date has passed and that have not yet received a
 * reminder today. Only the fields the reminder needs are returned.
 */
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(500);

    const result = [];
    for (const loan of loans) {
      const idempotencyKey = reminderKey(loan._id, today);
      const existing = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (existing?.status === "sent") continue;

      const [borrower, lender] = await Promise.all([
        ctx.db.get(loan.borrowerId),
        ctx.db.get(loan.ownerId),
      ]);
      result.push({
        loanId: loan._id,
        idempotencyKey,
        toolName: loan.toolName,
        borrowerName: borrower?.displayName ?? "Neighbour",
        lenderName: lender?.displayName ?? "Neighbour",
        dueDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return result;
  },
});

/**
 * Idempotent write-back from n8n, keyed by idempotencyKey.
 *
 *   claim  → created | updated (re-claim after failure / stale claim) | duplicate
 *   sent   → updated | created | duplicate (already sent: no-op)
 *   failed → updated | created | duplicate (already sent: never downgraded)
 *
 * n8n claims a key *before* sending, and skips when the answer is
 * "duplicate", so retried executions do not send the same reminder twice.
 */
export const recordEvent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    loanId: v.string(),
    kind: automationKindValidator,
    status: automationStatusValidator,
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId || !(await ctx.db.get(loanId))) {
      return { result: "rejected" as const, reason: "unknown loan" };
    }
    if (!args.idempotencyKey.startsWith(`${args.kind}:`) || args.idempotencyKey.length > 200) {
      return { result: "rejected" as const, reason: "malformed idempotency key" };
    }
    const now = Date.now();
    const detail = args.detail?.slice(0, 200);
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();

    if (!existing) {
      await ctx.db.insert("automationEvents", {
        idempotencyKey: args.idempotencyKey,
        loanId,
        kind: args.kind,
        status: args.status,
        attempts: 1,
        detail,
        updatedAt: now,
      });
      return { result: "created" as const, status: args.status };
    }

    if (existing.loanId !== loanId || existing.kind !== args.kind) {
      return { result: "rejected" as const, reason: "key belongs to another loan or kind" };
    }
    if (existing.status === "sent") {
      return { result: "duplicate" as const, status: existing.status };
    }
    if (
      args.status === "claimed" &&
      existing.status === "claimed" &&
      now - existing.updatedAt < CLAIM_TTL_MS
    ) {
      return { result: "duplicate" as const, status: existing.status };
    }

    await ctx.db.patch(existing._id, {
      status: args.status,
      attempts: existing.attempts + (args.status === "claimed" ? 1 : 0),
      detail: detail ?? existing.detail,
      updatedAt: now,
    });
    return { result: "updated" as const, status: args.status };
  },
});
