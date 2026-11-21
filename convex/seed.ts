import { internalMutation } from "./_generated/server";
import type { Category, Condition } from "./lib/validators";

const DEMO_TOOLS: { name: string; category: Category; condition: Condition; description: string }[] = [
  { name: "Cordless drill", category: "power-tools", condition: "good", description: "18V, two batteries and a bit set." },
  { name: "Extension ladder (5 m)", category: "hand-tools", condition: "fair", description: "Heavy, bring a friend." },
  { name: "Hedge trimmer", category: "garden", condition: "good", description: "Electric, 20 m cable included." },
  { name: "Pasta machine", category: "kitchen", condition: "new", description: "Used twice. Clamp included." },
  { name: "4-person tent", category: "camping", condition: "good", description: "Pitches in 10 minutes." },
  { name: "Carpet cleaner", category: "cleaning", condition: "worn", description: "Works great, a bit loud." },
];

/**
 * Demo data for local development only:
 *   npx convex run seed:demo
 * Creates two demo neighbours (not linked to any Clerk account) and their tools.
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("tools").first();
    if (existing) return "Database already has tools; skipping seed.";

    const owners = await Promise.all(
      ["Maya", "Tom"].map((displayName, i) =>
        ctx.db.insert("users", {
          tokenIdentifier: `demo|${displayName.toLowerCase()}`,
          displayName,
          role: "user",
          trustedLender: i === 0,
        }),
      ),
    );
    for (const [i, tool] of DEMO_TOOLS.entries()) {
      await ctx.db.insert("tools", { ...tool, ownerId: owners[i % owners.length] });
    }
    return `Seeded ${DEMO_TOOLS.length} tools.`;
  },
});

/**
 * Creates an approved loan that ended 3 days ago, to demo the reminder workflow:
 *   npx convex run seed:overdueLoan
 * The borrower is the most recently created real (signed-in) user, if any.
 * It lends an extra demo tool, so the six seeded tools stay available.
 */
export const overdueLoan = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").order("desc").collect();
    const borrower = users.find((u) => !u.tokenIdentifier.startsWith("demo|"));
    if (!borrower) return "Sign in to the app once first, so there is a borrower.";
    const lender = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", "demo|maya"))
      .unique();
    if (!lender) return "Run seed:demo first.";
    const toolId = await ctx.db.insert("tools", {
      ownerId: lender._id,
      name: "Pressure washer",
      category: "cleaning",
      condition: "good",
      description: "150 bar, patio brush included.",
    });
    const tool = { _id: toolId, name: "Pressure washer", ownerId: lender._id };

    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: borrower._id,
      startDate: day(-7),
      endDate: day(-3),
      status: "approved",
      decidedAt: Date.now(),
    });
    return `Created overdue loan ${loanId} (${tool.name}, borrowed by ${borrower.displayName}).`;
  },
});
