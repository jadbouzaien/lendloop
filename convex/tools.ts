import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertToolOwner, isAdmin, requireUser } from "./lib/auth";
import {
  approvedLoansForTool,
  availabilityFrom,
  upcomingBookings,
} from "./lib/availability";
import { todayUtc } from "./lib/dates";
import { appError } from "./lib/errors";
import { cleanText } from "./lib/text";
import { categoryValidator, conditionValidator, LIMITS } from "./lib/validators";
import { enqueueLoanEvent } from "./notifications";

const MAX_LIST = 200;

/**
 * Public, unauthenticated list. Returns only name + category of tools that
 * are currently available: no owner, description or loan information.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const tools = await ctx.db.query("tools").order("desc").take(MAX_LIST);
    const result: { _id: string; name: string; category: string }[] = [];
    for (const tool of tools) {
      const approved = await approvedLoansForTool(ctx, tool._id);
      if (availabilityFrom(approved, today).status === "available") {
        result.push({ _id: tool._id, name: tool.name, category: tool.category });
      }
    }
    return result;
  },
});

/** Signed-in catalogue with availability, filterable by category. */
export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const user = await requireUser(ctx);
    const today = todayUtc();

    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category))
          .order("desc")
          .take(MAX_LIST)
      : await ctx.db.query("tools").order("desc").take(MAX_LIST);

    const ownerCache = new Map<string, { displayName: string; trustedLender: boolean }>();
    return await Promise.all(
      tools.map(async (tool) => {
        let owner = ownerCache.get(tool.ownerId);
        if (!owner) {
          const doc = await ctx.db.get(tool.ownerId);
          owner = {
            displayName: doc?.displayName ?? "Former member",
            trustedLender: doc?.trustedLender ?? false,
          };
          ownerCache.set(tool.ownerId, owner);
        }
        const approved = await approvedLoansForTool(ctx, tool._id);
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          owner,
          isMine: tool.ownerId === user._id,
          availability: availabilityFrom(approved, today),
          bookings: upcomingBookings(approved, today),
        };
      }),
    );
  },
});

/** "My listings" with availability and number of pending requests. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();

    return await Promise.all(
      tools.map(async (tool) => {
        const approved = await approvedLoansForTool(ctx, tool._id);
        const pending = await ctx.db
          .query("loans")
          .withIndex("by_tool_status", (q) =>
            q.eq("toolId", tool._id).eq("status", "requested"),
          )
          .collect();
        return {
          ...tool,
          availability: availabilityFrom(approved, today),
          bookings: upcomingBookings(approved, today),
          pendingRequests: pending.length,
        };
      }),
    );
  },
});

const toolFields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

function cleanToolInput(input: { name: string; description: string }) {
  return {
    name: cleanText(input.name, "Name", LIMITS.toolName),
    description: cleanText(input.description, "Description", LIMITS.description),
  };
}

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: user._id,
      category: args.category,
      condition: args.condition,
      ...cleanToolInput(args),
    });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw appError("NOT_FOUND", "Listing not found.");
    assertToolOwner(user, tool);

    const cleaned = cleanToolInput(args);
    await ctx.db.patch(toolId, {
      category: args.category,
      condition: args.condition,
      ...cleaned,
    });

    // Keep the snapshot on open loans in sync with a renamed listing.
    if (cleaned.name !== tool.name) {
      for (const status of ["requested", "approved"] as const) {
        const loans = await ctx.db
          .query("loans")
          .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", status))
          .collect();
        for (const loan of loans) await ctx.db.patch(loan._id, { toolName: cleaned.name });
      }
    }
  },
});

/**
 * Owners can delete their listing when it is not currently lent out.
 * Admins can remove any listing (moderation). Pending requests are cancelled
 * and the borrowers notified; approved loans keep their history.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw appError("NOT_FOUND", "Listing not found.");

    const admin = isAdmin(user);
    if (!admin) assertToolOwner(user, tool);

    const approved = await approvedLoansForTool(ctx, toolId);
    if (!admin && approved.length > 0) {
      throw appError(
        "CONFLICT",
        "This tool has approved loans. Mark them returned (or wait for them to end) before deleting.",
      );
    }

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "requested"))
      .collect();
    for (const loan of pending) {
      await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
      const updated = (await ctx.db.get(loan._id))!;
      await enqueueLoanEvent(ctx, updated, "loan.cancelled", "borrower");
    }

    await ctx.db.delete(toolId);
  },
});
