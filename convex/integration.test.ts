import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { signBody, verifySignature } from "./lib/signature";
import { modules } from "./test.setup";

const SECRET = "test-inbound-secret";

function isoInDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function signedPost(
  t: ReturnType<typeof convexTest>,
  path: string,
  body: unknown,
  secret = SECRET,
) {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return await t.fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lendloop-timestamp": timestamp,
      "x-lendloop-signature": await signBody(secret, timestamp, raw),
    },
    body: raw,
  });
}

/** Seeds an approved loan whose end date was two days ago. */
async function seedOverdueLoan() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice", name: "Alice" });
  const bob = t.withIdentity({ subject: "bob", name: "Bob" });
  await alice.mutation(api.users.ensureCurrent, {});
  await bob.mutation(api.users.ensureCurrent, {});
  const toolId = await alice.mutation(api.tools.create, {
    name: "Tent",
    category: "camping",
    condition: "good",
    description: "",
  });
  const loanId = await bob.mutation(api.loans.request, {
    toolId,
    startDate: isoInDays(0),
    endDate: isoInDays(1),
  });
  await alice.mutation(api.loans.approve, { loanId });
  await t.run((ctx) =>
    ctx.db.patch(loanId, { startDate: isoInDays(-5), endDate: isoInDays(-2) }),
  );
  return { t, bob, loanId };
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CONVEX_HTTP_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.CONVEX_HTTP_SECRET;
});

describe("signatures", () => {
  test("accepts a valid signature and rejects tampering, wrong secret and replays", async () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = '{"a":1}';
    const signature = await signBody("s3cret", ts, body);

    expect(await verifySignature({ secret: "s3cret", timestamp: ts, signature, body })).toEqual({ ok: true });
    expect((await verifySignature({ secret: "s3cret", timestamp: ts, signature, body: '{"a":2}' })).ok).toBe(false);
    expect((await verifySignature({ secret: "other", timestamp: ts, signature, body })).ok).toBe(false);
    expect(
      (await verifySignature({
        secret: "s3cret",
        timestamp: ts,
        signature,
        body,
        nowMs: Date.now() + 10 * 60 * 1000,
      })).ok,
    ).toBe(false);
  });

  test("HTTP endpoints reject unsigned or mis-signed requests", async () => {
    const { t } = await seedOverdueLoan();
    const unsigned = await t.fetch("/n8n/overdue-loans", { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(401);
    const wrong = await signedPost(t, "/n8n/overdue-loans", {}, "not-the-secret");
    expect(wrong.status).toBe(401);
  });
});

describe("overdue reminders", () => {
  test("returns only minimal fields for overdue loans", async () => {
    const { t, loanId } = await seedOverdueLoan();
    const res = await signedPost(t, "/n8n/overdue-loans", {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.loans[0]).toEqual({
      loanId,
      idempotencyKey: `reminder:${loanId}:${data.date}`,
      toolName: "Tent",
      borrowerName: "Bob",
      lenderName: "Alice",
      dueDate: isoInDays(-2),
      daysOverdue: 2,
    });
  });

  test("write-back is idempotent: claim twice, send twice, one record", async () => {
    const { t, bob, loanId } = await seedOverdueLoan();
    const list = await (await signedPost(t, "/n8n/overdue-loans", {})).json();
    const key: string = list.loans[0].idempotencyKey;
    const event = (status: string) => ({
      idempotencyKey: key,
      loanId,
      kind: "reminder",
      status,
      detail: "Reminder posted to Discord",
    });

    expect((await (await signedPost(t, "/n8n/automation-events", event("claimed"))).json()).result).toBe("created");
    // A concurrent / retried execution must not send again.
    expect((await (await signedPost(t, "/n8n/automation-events", event("claimed"))).json()).result).toBe("duplicate");
    expect((await (await signedPost(t, "/n8n/automation-events", event("sent"))).json()).result).toBe("updated");
    expect((await (await signedPost(t, "/n8n/automation-events", event("sent"))).json()).result).toBe("duplicate");
    // A late "failed" from a retried branch never downgrades a sent reminder.
    expect((await (await signedPost(t, "/n8n/automation-events", event("failed"))).json()).result).toBe("duplicate");

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("sent");

    // Already reminded today → no longer returned to n8n.
    const again = await (await signedPost(t, "/n8n/overdue-loans", {})).json();
    expect(again.count).toBe(0);

    // And it shows up on the borrower's loan.
    const [loan] = await bob.query(api.loans.myRequests, {});
    expect(loan.overdue).toBe(true);
    expect(loan.activity.some((a) => a.kind === "reminder" && a.status === "sent")).toBe(true);
  });

  test("a failed reminder can be re-claimed and retried", async () => {
    const { t, loanId } = await seedOverdueLoan();
    const key = `reminder:${loanId}:2030-01-01`;
    const base = { idempotencyKey: key, loanId, kind: "reminder" as const };
    await t.mutation(internal.automation.recordEvent, { ...base, status: "claimed" });
    await t.mutation(internal.automation.recordEvent, { ...base, status: "failed" });
    const retry = await t.mutation(internal.automation.recordEvent, { ...base, status: "claimed" });
    expect(retry.result).toBe("updated");
  });

  test("rejects malformed write-backs", async () => {
    const { t, loanId } = await seedOverdueLoan();
    const bad = await signedPost(t, "/n8n/automation-events", { idempotencyKey: "x", loanId, kind: "spam", status: "sent" });
    expect(bad.status).toBe(400);
    const unknownLoan = await signedPost(t, "/n8n/automation-events", {
      idempotencyKey: "reminder:abc",
      loanId: "not-a-loan-id",
      kind: "reminder",
      status: "sent",
    });
    expect(unknownLoan.status).toBe(422);
  });
});

describe("outbound webhook delivery", () => {
  test("retries transient failures then succeeds", async () => {
    const { t, loanId } = await seedOverdueLoan();
    process.env.N8N_WEBHOOK_URL = "https://n8n.example/webhook/lendloop-loan-events";
    process.env.N8N_WEBHOOK_SECRET = "outbound";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const deliveryId = await t.run(async (ctx) =>
      ctx.db.insert("webhookDeliveries", {
        eventType: "loan.approved",
        loanId: loanId as Id<"loans">,
        payload: '{"hello":"n8n"}',
        status: "pending",
        attempts: 0,
      }),
    );
    await t.action(internal.webhooks.deliver, { deliveryId });
    let row = await t.run((ctx) => ctx.db.get(deliveryId));
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "n8n responded HTTP 503" });

    await t.action(internal.webhooks.deliver, { deliveryId });
    row = await t.run((ctx) => ctx.db.get(deliveryId));
    expect(row).toMatchObject({ status: "delivered", attempts: 2 });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    const ok = await verifySignature({
      secret: "outbound",
      timestamp: headers.get("x-lendloop-timestamp"),
      signature: headers.get("x-lendloop-signature"),
      body: (init as RequestInit).body as string,
    });
    expect(ok).toEqual({ ok: true });

    fetchMock.mockRestore();
    delete process.env.N8N_WEBHOOK_URL;
    delete process.env.N8N_WEBHOOK_SECRET;
  });

  test("a 401 from n8n fails immediately (no silent retry loop)", async () => {
    const { t, loanId } = await seedOverdueLoan();
    process.env.N8N_WEBHOOK_URL = "https://n8n.example/webhook/x";
    process.env.N8N_WEBHOOK_SECRET = "outbound";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 401 }));
    const deliveryId = await t.run(async (ctx) =>
      ctx.db.insert("webhookDeliveries", {
        eventType: "loan.approved",
        loanId: loanId as Id<"loans">,
        payload: "{}",
        status: "pending",
        attempts: 0,
      }),
    );
    await t.action(internal.webhooks.deliver, { deliveryId });
    expect(await t.run((ctx) => ctx.db.get(deliveryId))).toMatchObject({ status: "failed", attempts: 1 });
    fetchMock.mockRestore();
    delete process.env.N8N_WEBHOOK_URL;
    delete process.env.N8N_WEBHOOK_SECRET;
  });
});
