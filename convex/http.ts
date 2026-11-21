import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { todayUtc } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./lib/signature";

/**
 * Endpoints called by n8n. Both require an HMAC signature made with
 * CONVEX_HTTP_SECRET (a different secret from the outbound one, so a leaked
 * key only compromises one direction).
 */

const MAX_BODY_BYTES = 10_000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Reads the raw body and checks the signature. Returns the body or an error response. */
async function authenticate(req: Request): Promise<{ body: string } | { error: Response }> {
  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return { error: json(413, { error: "payload too large" }) };

  const result = await verifySignature({
    secret: process.env.CONVEX_HTTP_SECRET,
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    signature: req.headers.get(SIGNATURE_HEADER),
    body,
  });
  if (!result.ok) {
    // Log the reason server-side; tell the caller as little as possible.
    console.warn(`Rejected n8n request to ${new URL(req.url).pathname}: ${result.reason}`);
    return { error: json(401, { error: "invalid signature" }) };
  }
  return { body };
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const http = httpRouter();

/** Overdue loans for the daily reminder workflow. POST so the request is signed like every other call. */
http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = await authenticate(req);
    if ("error" in auth) return auth.error;

    const today = todayUtc();
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today });
    return json(200, { date: today, count: loans.length, loans });
  }),
});

/** Idempotent status write-back for notifications and reminders. */
http.route({
  path: "/n8n/automation-events",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = await authenticate(req);
    if ("error" in auth) return auth.error;

    const data = parseJson(auth.body);
    const { idempotencyKey, loanId, kind, status, detail } = data ?? {};
    const valid =
      typeof idempotencyKey === "string" &&
      typeof loanId === "string" &&
      (kind === "notification" || kind === "reminder") &&
      (status === "claimed" || status === "sent" || status === "failed") &&
      (detail === undefined || typeof detail === "string");
    if (!valid) return json(400, { error: "invalid body" });

    const outcome = await ctx.runMutation(internal.automation.recordEvent, {
      idempotencyKey,
      loanId,
      kind,
      status,
      detail,
    });
    return json(outcome.result === "rejected" ? 422 : 200, { idempotencyKey, ...outcome });
  }),
});

export default http;
