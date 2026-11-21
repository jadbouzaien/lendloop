/**
 * Human-readable wording for automation records, shared by the loan activity
 * feed and the admin "Automation health" panel.
 */

export const EVENT_LABELS: Record<string, string> = {
  "loan.requested": "New request",
  "loan.approved": "Request approved",
  "loan.declined": "Request declined",
  "loan.cancelled": "Request withdrawn",
  "loan.returned": "Loan marked returned",
};

export const eventLabel = (type: string) => EVENT_LABELS[type] ?? type;

export type ParsedDetail = {
  /** e.g. "New request" or "3 days overdue". */
  label?: string;
  /** "lender" | "borrower" when known. */
  recipient?: string;
  /** Raw error message reported by n8n, when the record failed. */
  error?: string;
};

/**
 * n8n writes `detail` as "<type> → <role>" on success and "<type>: <error>"
 * on failure (reminders: "<n> day(s) overdue" or the bare error).
 */
export function parseDetail(kind: "notification" | "reminder", status: string, detail?: string): ParsedDetail {
  if (!detail) return {};
  const m = /^(loan\.[a-z]+)(?: → (lender|borrower)|: ([\s\S]*))?$/.exec(detail);
  if (m) return { label: eventLabel(m[1]), recipient: m[2], error: m[3] };
  if (kind === "reminder") {
    const overdue = /^(\d+) day\(s\) overdue$/.exec(detail);
    if (overdue) {
      const n = Number(overdue[1]);
      return { label: `${n} day${n === 1 ? "" : "s"} overdue` };
    }
    if (status === "failed") return { error: detail };
  }
  return { label: detail };
}

/** Likely cause of a failed Convex → n8n delivery, from the recorded error. */
export function deliveryHint(error?: string): string {
  if (!error) return "Unknown error. Check the Convex logs.";
  if (error.includes("not set")) return "N8N_WEBHOOK_URL or N8N_WEBHOOK_SECRET is missing from the Convex environment.";
  if (error.includes("HTTP 401")) return "n8n rejected the signature: N8N_WEBHOOK_SECRET differs between Convex and n8n.";
  if (error.includes("HTTP 404")) return "Webhook not found: is the notification workflow published in n8n?";
  if (/HTTP 5\d\d/.test(error)) return "n8n failed while handling the event. Open its execution log.";
  if (/HTTP \d+/.test(error)) return "n8n refused the event. Open its execution log.";
  return "n8n was unreachable: is it running, and does N8N_WEBHOOK_URL point to it?";
}

/** Likely cause of a failure reported back by n8n (the Discord step). */
export const DISCORD_HINT =
  "n8n received the event but could not post to Discord. Check the Discord webhook credential in n8n.";
