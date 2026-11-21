import { v, type Infer } from "convex/values";

/**
 * Single source of truth for enum-like fields. These validators are used both
 * in the schema and in function arguments, so the database can never contain a
 * value the UI does not know about.
 */

export const CATEGORIES = [
  { value: "power-tools", label: "Power tools" },
  { value: "hand-tools", label: "Hand tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "cleaning", label: "Cleaning" },
  { value: "sports", label: "Sports & outdoors" },
  { value: "other", label: "Other" },
] as const;

export const CONDITIONS = [
  { value: "new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "worn", label: "Well used" },
] as const;

export const categoryValidator = v.union(
  v.literal("power-tools"),
  v.literal("hand-tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("sports"),
  v.literal("other"),
);

export const conditionValidator = v.union(
  v.literal("new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);

export const roleValidator = v.union(v.literal("admin"), v.literal("user"));

/**
 * Loan lifecycle:
 *   requested ──approve──▶ approved ──markReturned──▶ returned
 *       │ └──decline──▶ declined
 *       └────cancel───▶ cancelled   (borrower withdraws, or listing removed)
 */
export const loanStatusValidator = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const automationKindValidator = v.union(
  v.literal("notification"),
  v.literal("reminder"),
);

export const automationStatusValidator = v.union(
  v.literal("claimed"),
  v.literal("sent"),
  v.literal("failed"),
);

export type Category = Infer<typeof categoryValidator>;
export type Condition = Infer<typeof conditionValidator>;
export type Role = Infer<typeof roleValidator>;
export type LoanStatus = Infer<typeof loanStatusValidator>;
export type AutomationKind = Infer<typeof automationKindValidator>;
export type AutomationStatus = Infer<typeof automationStatusValidator>;

export const LIMITS = {
  toolName: { min: 2, max: 80 },
  description: { min: 0, max: 500 },
  requestMessage: { min: 0, max: 300 },
  maxLoanDays: 30,
  maxDaysAhead: 180,
} as const;
