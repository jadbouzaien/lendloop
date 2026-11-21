import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  automationKindValidator,
  automationStatusValidator,
  categoryValidator,
  conditionValidator,
  loanStatusValidator,
  roleValidator,
} from "./lib/validators";

export default defineSchema({
  /**
   * Local profile linked to a Clerk identity. We deliberately store only what
   * the product needs: a display name (first name) shown to neighbours, the
   * role and the trusted-lender flag. No email, phone or address is copied
   * out of Clerk.
   */
  users: defineTable({
    tokenIdentifier: v.string(),
    displayName: v.string(),
    role: roleValidator,
    trustedLender: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    // Snapshot so loan history stays readable if the listing is removed.
    toolName: v.string(),
    // Denormalised so access checks never need to load the tool.
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    // Inclusive ISO dates (YYYY-MM-DD, UTC).
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_status_end", ["status", "endDate"]),

  /**
   * Results reported back by n8n (notifications and reminders). The unique
   * idempotencyKey makes write-backs safe to retry.
   */
  automationEvents: defineTable({
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    kind: automationKindValidator,
    status: automationStatusValidator,
    attempts: v.number(),
    detail: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"])
    .index("by_status", ["status"]),

  /**
   * Transactional outbox for Convex → n8n webhooks. A row is written in the
   * same transaction as the loan change, then delivered by a scheduled action
   * with retries and exponential backoff.
   */
  webhookDeliveries: defineTable({
    eventType: v.string(),
    loanId: v.id("loans"),
    payload: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_loan", ["loanId"]),
});
