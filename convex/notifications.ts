import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

export type LoanEventType =
  | "loan.requested"
  | "loan.approved"
  | "loan.declined"
  | "loan.cancelled"
  | "loan.returned";

export type Recipient = "lender" | "borrower";

/**
 * The exact shape n8n receives. It carries only what a notification needs:
 * first names, the tool name and the dates. No emails, Clerk IDs, messages or
 * descriptions ever leave Convex.
 */
export type LoanEventPayload = {
  eventId: string;
  type: LoanEventType;
  occurredAt: string;
  loan: { id: string; status: string; startDate: string; endDate: string };
  tool: { name: string };
  recipient: { role: Recipient; displayName: string };
  counterparty: { displayName: string };
};

/**
 * Transactional outbox: the delivery row is written in the same transaction
 * as the loan change, so a notification is never lost or sent for a change
 * that was rolled back. Delivery happens asynchronously with retries.
 */
export async function enqueueLoanEvent(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  type: LoanEventType,
  recipient: Recipient,
) {
  const [owner, borrower] = await Promise.all([
    ctx.db.get(loan.ownerId),
    ctx.db.get(loan.borrowerId),
  ]);
  const lenderName = owner?.displayName ?? "Neighbour";
  const borrowerName = borrower?.displayName ?? "Neighbour";

  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    eventType: type,
    loanId: loan._id,
    payload: "",
    status: "pending",
    attempts: 0,
  });

  const payload: LoanEventPayload = {
    // The outbox row id doubles as a stable event id for de-duplication.
    eventId: deliveryId,
    type,
    occurredAt: new Date().toISOString(),
    loan: {
      id: loan._id,
      status: loan.status,
      startDate: loan.startDate,
      endDate: loan.endDate,
    },
    tool: { name: loan.toolName },
    recipient: {
      role: recipient,
      displayName: recipient === "lender" ? lenderName : borrowerName,
    },
    counterparty: {
      displayName: recipient === "lender" ? borrowerName : lenderName,
    },
  };

  await ctx.db.patch(deliveryId, { payload: JSON.stringify(payload) });
  await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
}
