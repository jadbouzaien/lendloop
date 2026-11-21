import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { loanActivity } from "./lib/activity";
import { assertBorrower, assertLender, requireUser } from "./lib/auth";
import { approvedLoansForTool, conflictsWithApproved } from "./lib/availability";
import { daysBetween, isIsoDate, rangesOverlap, todayUtc } from "./lib/dates";
import { appError } from "./lib/errors";
import { cleanText } from "./lib/text";
import { LIMITS } from "./lib/validators";
import { enqueueLoanEvent } from "./notifications";

async function getLoanOrThrow(ctx: QueryCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw appError("NOT_FOUND", "Request not found.");
  return loan;
}

function assertStatus(loan: Doc<"loans">, expected: Doc<"loans">["status"], action: string) {
  if (loan.status !== expected) {
    throw appError("CONFLICT", `Cannot ${action} a request that is ${loan.status}.`);
  }
}

/** Shapes a loan for the current viewer, adding names and automation activity. */
async function presentLoan(ctx: QueryCtx, loan: Doc<"loans">) {
  const [owner, borrower] = await Promise.all([
    ctx.db.get(loan.ownerId),
    ctx.db.get(loan.borrowerId),
  ]);
  const today = todayUtc();
  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    toolId: loan.toolId,
    toolName: loan.toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    message: loan.message,
    status: loan.status,
    decidedAt: loan.decidedAt,
    returnedAt: loan.returnedAt,
    overdue: loan.status === "approved" && loan.endDate < today,
    lender: { displayName: owner?.displayName ?? "Former member", trustedLender: owner?.trustedLender ?? false },
    borrower: { displayName: borrower?.displayName ?? "Former member" },
    activity: await loanActivity(ctx, loan._id),
  };
}

export type PresentedLoan = Awaited<ReturnType<typeof presentLoan>>;

/** Requests I made as a borrower. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((l) => presentLoan(ctx, l)));
  },
});

/** Requests for tools I own. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((l) => presentLoan(ctx, l)));
  },
});

export { presentLoan };

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw appError("NOT_FOUND", "This tool is no longer listed.");
    if (tool.ownerId === user._id) {
      throw appError("FORBIDDEN", "You cannot borrow your own tool.");
    }

    const { startDate, endDate } = args;
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      throw appError("INVALID_INPUT", "Dates must be valid (YYYY-MM-DD).");
    }
    const today = todayUtc();
    if (startDate < today) throw appError("INVALID_INPUT", "Start date cannot be in the past.");
    if (endDate < startDate) throw appError("INVALID_INPUT", "End date must be on or after the start date.");
    if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
      throw appError("INVALID_INPUT", `Loans are limited to ${LIMITS.maxLoanDays} days.`);
    }
    if (daysBetween(today, startDate) > LIMITS.maxDaysAhead) {
      throw appError("INVALID_INPUT", `Requests can be made up to ${LIMITS.maxDaysAhead} days ahead.`);
    }

    const approved = await approvedLoansForTool(ctx, tool._id);
    if (conflictsWithApproved(approved, { startDate, endDate })) {
      throw appError("CONFLICT", "The tool is already booked for some of those dates.");
    }

    const myPending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "requested"))
      .collect();
    if (myPending.some((l) => l.borrowerId === user._id)) {
      throw appError("CONFLICT", "You already have a pending request for this tool.");
    }

    const message =
      args.message !== undefined
        ? cleanText(args.message, "Message", LIMITS.requestMessage)
        : undefined;

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: user._id,
      startDate,
      endDate,
      message: message || undefined,
      status: "requested",
    });
    const loan = (await ctx.db.get(loanId))!;
    await enqueueLoanEvent(ctx, loan, "loan.requested", "lender");
    return loanId;
  },
});

/**
 * Lender approves. Overlap is re-checked inside the transaction (Convex
 * mutations are serialisable), and any other pending requests that now
 * collide are declined automatically.
 */
export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const user = await requireUser(ctx);
    const loan = await getLoanOrThrow(ctx, loanId);
    assertLender(user, loan);
    assertStatus(loan, "requested", "approve");
    if (loan.endDate < todayUtc()) {
      throw appError("CONFLICT", "This request's dates have already passed.");
    }

    const approved = await approvedLoansForTool(ctx, loan.toolId);
    if (conflictsWithApproved(approved, loan, loan._id)) {
      throw appError("CONFLICT", "Another approved loan already covers these dates.");
    }

    const now = Date.now();
    await ctx.db.patch(loanId, { status: "approved", decidedAt: now });
    await enqueueLoanEvent(ctx, (await ctx.db.get(loanId))!, "loan.approved", "borrower");

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "requested"))
      .collect();
    for (const other of pending) {
      if (other._id !== loanId && rangesOverlap(other, loan)) {
        await ctx.db.patch(other._id, { status: "declined", decidedAt: now });
        await enqueueLoanEvent(ctx, (await ctx.db.get(other._id))!, "loan.declined", "borrower");
      }
    }
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const user = await requireUser(ctx);
    const loan = await getLoanOrThrow(ctx, loanId);
    assertLender(user, loan);
    assertStatus(loan, "requested", "decline");
    await ctx.db.patch(loanId, { status: "declined", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, (await ctx.db.get(loanId))!, "loan.declined", "borrower");
  },
});

/** Borrower withdraws a request that has not been answered yet. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const user = await requireUser(ctx);
    const loan = await getLoanOrThrow(ctx, loanId);
    assertBorrower(user, loan);
    assertStatus(loan, "requested", "cancel");
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, (await ctx.db.get(loanId))!, "loan.cancelled", "lender");
  },
});

/** The lender confirms the tool came back (they are the one who can verify it). */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const user = await requireUser(ctx);
    const loan = await getLoanOrThrow(ctx, loanId);
    assertLender(user, loan);
    assertStatus(loan, "approved", "mark as returned");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await enqueueLoanEvent(ctx, (await ctx.db.get(loanId))!, "loan.returned", "borrower");
  },
});
