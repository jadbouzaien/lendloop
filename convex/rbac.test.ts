import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

function isoInDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice", name: "Alice Martin" });
  const bob = t.withIdentity({ subject: "bob", name: "Bob Durand" });
  const carol = t.withIdentity({ subject: "carol", name: "Carol Admin" });
  await alice.mutation(api.users.ensureCurrent, {});
  await bob.mutation(api.users.ensureCurrent, {});
  const carolId = await carol.mutation(api.users.ensureCurrent, {});
  await t.mutation(internal.users.setRole, { userId: carolId, role: "admin" });

  const drillId = await alice.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power-tools",
    condition: "good",
    description: "Comes with two batteries.",
  });
  return { t, alice, bob, carol, drillId };
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe("public catalogue", () => {
  test("exposes only name and category, no owner details", async () => {
    const { t } = await setup();
    const tools = await t.query(api.tools.listPublic, {});
    expect(tools).toHaveLength(1);
    expect(Object.keys(tools[0]).sort()).toEqual(["_id", "category", "name"]);
  });

  test("signed-out users cannot read the full catalogue", async () => {
    const { t } = await setup();
    await expect(t.query(api.tools.list, {})).rejects.toThrow(/sign in/i);
  });
});

describe("listing ownership", () => {
  test("a user cannot edit or delete someone else's listing", async () => {
    const { bob, drillId } = await setup();
    await expect(
      bob.mutation(api.tools.update, {
        toolId: drillId,
        name: "Mine now",
        category: "garden",
        condition: "worn",
        description: "",
      }),
    ).rejects.toThrow(/own listings/);
    await expect(bob.mutation(api.tools.remove, { toolId: drillId })).rejects.toThrow(/own listings/);
  });

  test("an admin can remove any listing", async () => {
    const { t, carol, drillId } = await setup();
    await carol.mutation(api.tools.remove, { toolId: drillId });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(0);
  });

  test("users cannot make themselves admin or trusted", async () => {
    const { bob } = await setup();
    const me = await bob.query(api.users.me, {});
    await expect(
      bob.mutation(api.admin.setTrustedLender, { userId: me!._id, trusted: true }),
    ).rejects.toThrow(/Admins only/);
    await expect(bob.query(api.admin.overview, {})).rejects.toThrow(/Admins only/);
  });

  test("input is validated server-side", async () => {
    const { alice } = await setup();
    await expect(
      alice.mutation(api.tools.create, {
        name: " ",
        category: "garden",
        condition: "good",
        description: "",
      }),
    ).rejects.toThrow(/Name/);
  });
});

describe("borrowing rules", () => {
  test("cannot borrow your own tool", async () => {
    const { alice, drillId } = await setup();
    await expect(
      alice.mutation(api.loans.request, {
        toolId: drillId,
        startDate: isoInDays(1),
        endDate: isoInDays(2),
      }),
    ).rejects.toThrow(/own tool/);
  });

  test("only the lender can approve, and overlapping requests are declined", async () => {
    const { t, alice, bob, carol, drillId } = await setup();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: drillId,
      startDate: isoInDays(1),
      endDate: isoInDays(3),
    });
    const otherId = await carol.mutation(api.loans.request, {
      toolId: drillId,
      startDate: isoInDays(2),
      endDate: isoInDays(4),
    });

    // Borrower and admins cannot approve on the lender's behalf.
    await expect(bob.mutation(api.loans.approve, { loanId })).rejects.toThrow(/lender/);
    await expect(carol.mutation(api.loans.approve, { loanId })).rejects.toThrow(/lender/);

    await alice.mutation(api.loans.approve, { loanId });
    const other = await t.run((ctx) => ctx.db.get(otherId));
    expect(other?.status).toBe("declined");

    await expect(
      carol.mutation(api.loans.request, {
        toolId: drillId,
        startDate: isoInDays(3),
        endDate: isoInDays(5),
      }),
    ).rejects.toThrow(/already booked/);
  });

  test("each status change writes a minimal webhook payload to the outbox", async () => {
    const { t, alice, bob, drillId } = await setup();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: drillId,
      startDate: isoInDays(1),
      endDate: isoInDays(2),
      message: "Thanks! My phone is 555-1234",
    });
    await alice.mutation(api.loans.approve, { loanId });

    const deliveries = await t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
    expect(deliveries.map((d) => d.eventType)).toEqual(["loan.requested", "loan.approved"]);
    const payload = JSON.parse(deliveries[1].payload);
    expect(payload.recipient).toEqual({ role: "borrower", displayName: "Bob" });
    expect(payload.counterparty).toEqual({ displayName: "Alice" });
    // Free-text messages and identity data never leave Convex.
    expect(deliveries[0].payload).not.toContain("555-1234");
    expect(deliveries[0].payload).not.toContain("Martin");
  });

  test("lender marks returned; borrower cannot", async () => {
    const { alice, bob, drillId } = await setup();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: drillId,
      startDate: isoInDays(0),
      endDate: isoInDays(1),
    });
    await alice.mutation(api.loans.approve, { loanId });
    await expect(bob.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(/lender/);
    await alice.mutation(api.loans.markReturned, { loanId });
    const [loan] = await bob.query(api.loans.myRequests, {});
    expect(loan.status).toBe("returned");
  });
});

describe("profile", () => {
  test("keeps only a first name, falling back to the client's Clerk first name", async () => {
    const t = convexTest(schema, modules);
    const fromToken = t.withIdentity({ subject: "a", name: "Alice Martin" });
    const noClaims = t.withIdentity({ subject: "b" });
    const hostile = t.withIdentity({ subject: "c" });

    await fromToken.mutation(api.users.ensureCurrent, { firstName: "Mallory" });
    await noClaims.mutation(api.users.ensureCurrent, { firstName: "Jad" });
    await hostile.mutation(api.users.ensureCurrent, { firstName: "<b>@everyone</b> x" });

    expect((await fromToken.query(api.users.me))?.displayName).toBe("Alice");
    expect((await noClaims.query(api.users.me))?.displayName).toBe("Jad");
    expect((await hostile.query(api.users.me))?.displayName).toBe("beveryoneb");
  });
});

describe("automation health", () => {
  test("explains a notification n8n could not post, and only admins can re-send it", async () => {
    const { t, bob, carol, drillId } = await setup();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: drillId,
      startDate: isoInDays(1),
      endDate: isoInDays(2),
    });
    const deliveryId = await t.run(async (ctx) => {
      const d = (await ctx.db.query("webhookDeliveries").collect())[0];
      await ctx.db.patch(d._id, { status: "delivered", attempts: 1 });
      return d._id;
    });
    await t.mutation(internal.automation.recordEvent, {
      idempotencyKey: `notification:${deliveryId}`,
      loanId,
      kind: "notification",
      status: "failed",
      detail: "loan.requested: Discord returned 404",
    });

    const { issues } = await carol.query(api.admin.overview);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      stage: "n8n-to-discord",
      title: "New request notification",
      about: "Cordless drill · to Alice (lender)",
      error: "Discord returned 404",
      retryDeliveryId: deliveryId,
    });

    await expect(bob.mutation(api.admin.retryDelivery, { deliveryId })).rejects.toThrow(/admin/i);
    await carol.mutation(api.admin.retryDelivery, { deliveryId });
    expect(await t.run((ctx) => ctx.db.get(deliveryId))).toMatchObject({ status: "pending", attempts: 0 });
  });
});
