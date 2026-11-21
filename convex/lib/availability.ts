import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { rangesOverlap } from "./dates";

export async function approvedLoansForTool(
  ctx: QueryCtx,
  toolId: Id<"tools">,
): Promise<Doc<"loans">[]> {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

export type Availability =
  | { status: "available" }
  | { status: "on-loan"; until: string; overdue: boolean };

/**
 * A tool is "on loan" while an approved loan has started and has not been
 * marked returned (including overdue loans). Future bookings leave it available.
 */
export function availabilityFrom(approved: Doc<"loans">[], today: string): Availability {
  const current = approved.find((l) => l.startDate <= today);
  if (!current) return { status: "available" };
  return { status: "on-loan", until: current.endDate, overdue: current.endDate < today };
}

export function upcomingBookings(approved: Doc<"loans">[], today: string) {
  return approved
    .filter((l) => l.endDate >= today)
    .map((l) => ({ startDate: l.startDate, endDate: l.endDate }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function conflictsWithApproved(
  approved: Doc<"loans">[],
  range: { startDate: string; endDate: string },
  ignoreLoanId?: Id<"loans">,
): boolean {
  return approved.some((l) => l._id !== ignoreLoanId && rangesOverlap(l, range));
}
