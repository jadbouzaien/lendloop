import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./errors";

/**
 * Authorization helpers. Every public query/mutation that touches private
 * data goes through one of these, so access rules live on the server and the
 * UI only mirrors them.
 */

type Ctx = QueryCtx | MutationCtx;

export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw appError("UNAUTHENTICATED", "Please sign in to continue.");
  return user;
}

export function isAdmin(user: Doc<"users">): boolean {
  return user.role === "admin";
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (!isAdmin(user)) throw appError("FORBIDDEN", "Admins only.");
  return user;
}

export function assertToolOwner(user: Doc<"users">, tool: Doc<"tools">) {
  if (tool.ownerId !== user._id) {
    throw appError("FORBIDDEN", "You can only manage your own listings.");
  }
}

export function assertLender(user: Doc<"users">, loan: Doc<"loans">) {
  if (loan.ownerId !== user._id) {
    throw appError("FORBIDDEN", "Only the lender can do this.");
  }
}

export function assertBorrower(user: Doc<"users">, loan: Doc<"loans">) {
  if (loan.borrowerId !== user._id) {
    throw appError("FORBIDDEN", "Only the borrower can do this.");
  }
}
