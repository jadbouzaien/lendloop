import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { deliveryHint, DISCORD_HINT, eventLabel, parseDetail } from "./lib/describe";
import { appError } from "./lib/errors";
import { presentLoan } from "./loans";
import type { LoanEventPayload } from "./notifications";

/** One problem on the "Automation health" panel, worded for a human. */
export type AutomationIssue = {
  _id: string;
  /** Where it broke: Convex → n8n, or n8n → Discord. */
  stage: "convex-to-n8n" | "n8n-to-discord";
  /** e.g. "New request notification". */
  title: string;
  /** e.g. "Pasta machine · to Tom (lender)". */
  about: string;
  error: string;
  hint: string;
  attempts: number;
  at: number;
  /** Outbox row to re-send, when a manual retry makes sense. */
  retryDeliveryId?: Id<"webhookDeliveries">;
  /** Shown instead of a Retry button. */
  note?: string;
};

function parsePayload(delivery: Doc<"webhookDeliveries">): LoanEventPayload | null {
  try {
    return JSON.parse(delivery.payload) as LoanEventPayload;
  } catch {
    return null;
  }
}

function aboutFromPayload(p: LoanEventPayload | null, fallbackTool?: string) {
  if (!p) return fallbackTool ?? "Unknown loan";
  return `${p.tool.name} · to ${p.recipient.displayName} (${p.recipient.role})`;
}

async function automationIssue(ctx: QueryCtx, e: Doc<"automationEvents">): Promise<AutomationIssue> {
  const parsed = parseDetail(e.kind, e.status, e.detail);
  const loan = await ctx.db.get(e.loanId);
  const base = {
    _id: e._id,
    stage: "n8n-to-discord" as const,
    error: parsed.error ?? e.detail ?? "No error message recorded.",
    hint: DISCORD_HINT,
    attempts: e.attempts,
    at: e.updatedAt,
  };

  if (e.kind === "reminder") {
    const borrower = loan && (await ctx.db.get(loan.borrowerId));
    return {
      ...base,
      title: "Overdue reminder",
      about: `${loan?.toolName ?? "Unknown loan"} · to ${borrower?.displayName ?? "the borrower"} (borrower)`,
      note: loan?.status === "approved" ? "Retried automatically at the next daily run." : "Loan is closed; nothing to retry.",
    };
  }

  // Notification keys are "notification:<outbox row id>", so the original
  // event can be re-sent as is.
  const deliveryId = ctx.db.normalizeId("webhookDeliveries", e.idempotencyKey.slice("notification:".length));
  const delivery = deliveryId ? await ctx.db.get(deliveryId) : null;
  const payload = delivery ? parsePayload(delivery) : null;
  return {
    ...base,
    title: `${payload ? eventLabel(payload.type) : (parsed.label ?? "Loan")} notification`,
    about: aboutFromPayload(payload, loan?.toolName),
    retryDeliveryId: delivery ? delivery._id : undefined,
    note: delivery ? undefined : "Original event not found; cannot re-send.",
  };
}

/** Everything on the admin dashboard. Every function here starts with requireAdmin. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const loans = await ctx.db.query("loans").order("desc").take(100);
    const users = await ctx.db.query("users").take(500);
    const failedDeliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(50);
    const failedAutomations = await ctx.db
      .query("automationEvents")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(50);

    const listingCounts = new Map<string, number>();
    for await (const tool of ctx.db.query("tools")) {
      listingCounts.set(tool.ownerId, (listingCounts.get(tool.ownerId) ?? 0) + 1);
    }

    return {
      loans: await Promise.all(loans.map((l) => presentLoan(ctx, l))),
      users: users.map((u) => ({
        _id: u._id,
        displayName: u.displayName,
        role: u.role,
        trustedLender: u.trustedLender,
        listings: listingCounts.get(u._id) ?? 0,
      })),
      issues: [
        ...failedDeliveries.map(
          (d): AutomationIssue => ({
            _id: d._id,
            stage: "convex-to-n8n",
            title: `${eventLabel(d.eventType)} notification`,
            about: aboutFromPayload(parsePayload(d)),
            error: d.lastError ?? "No error message recorded.",
            hint: deliveryHint(d.lastError),
            attempts: d.attempts,
            at: d._creationTime,
            retryDeliveryId: d._id,
          }),
        ),
        ...(await Promise.all(failedAutomations.map((e) => automationIssue(ctx, e)))),
      ].sort((a, b) => b.at - a.at),
    };
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw appError("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Manually re-send a loan event, after fixing whatever broke: either the
 * webhook exhausted its retries (Convex → n8n), or n8n received it but
 * reported a failed notification (n8n → Discord). n8n's idempotency claim
 * still prevents a second message if the first one did go out.
 */
export const retryDelivery = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    await requireAdmin(ctx);
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery) throw appError("NOT_FOUND", "Delivery not found.");
    const automation = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", `notification:${deliveryId}`))
      .unique();
    const retryable = delivery.status === "failed" || (delivery.status === "delivered" && automation?.status === "failed");
    if (!retryable) throw appError("CONFLICT", "Only failed notifications can be retried.");
    await ctx.db.patch(deliveryId, { status: "pending", attempts: 0, lastError: undefined });
    await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
  },
});
