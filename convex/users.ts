import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { appError } from "./lib/errors";
import { roleValidator } from "./lib/validators";

/** First word only, letters/digits/apostrophe/hyphen, max 40 chars. */
const firstWord = (value?: string) =>
  value?.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'’-]/gu, "").slice(0, 40) || undefined;

/**
 * Only the first name is kept and shown to neighbours (data minimisation).
 * The verified token claims win. Clerk's default Convex session token carries
 * no name claims, so the client may supply its Clerk first name as a
 * fallback: it is a cosmetic, self-chosen label, never used for access control.
 */
function displayNameFrom(
  identity: { givenName?: string; name?: string; nickname?: string },
  clientFirstName?: string,
): string {
  return (
    firstWord(identity.givenName) ??
    firstWord(identity.name) ??
    firstWord(clientFirstName) ??
    firstWord(identity.nickname) ??
    "Neighbour"
  );
}

/**
 * Called by the client after sign-in. Creates the local profile on first
 * login. New users are always `user`; roles are never taken from the client.
 */
export const ensureCurrent = mutation({
  args: { firstName: v.optional(v.string()) },
  handler: async (ctx, { firstName }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError("UNAUTHENTICATED", "Please sign in to continue.");

    const displayName = displayNameFrom(identity, firstName?.slice(0, 100));
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      if (existing.displayName !== displayName) {
        await ctx.db.patch(existing._id, { displayName });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      displayName,
      role: "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      displayName: user.displayName,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

/**
 * Role changes are an operator action, not exposed to any client:
 *   npx convex run users:setRole '{"userId":"<id>","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, { userId, role }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw appError("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { role });
  },
});
