import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/signature";

/** Delay before attempt n+1 (ms). After the last one the delivery is marked failed. */
export const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;

export const getDelivery = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => await ctx.db.get(deliveryId),
});

/**
 * Sends one outbox row to the n8n webhook, signed with HMAC-SHA256.
 * Network errors, timeouts, 404 (n8n answers 404 while a workflow is being
 * (re)activated), 408/429 and 5xx are retried with backoff. Other 4xx
 * (e.g. 401 bad signature) fail immediately so misconfiguration is visible
 * instead of being retried for an hour.
 */
export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.runQuery(internal.webhooks.getDelivery, { deliveryId });
    if (!delivery || delivery.status !== "pending") return;

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok: false,
        retryable: false,
        error: "N8N_WEBHOOK_URL or N8N_WEBHOOK_SECRET is not set",
      });
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    let ok = false;
    let retryable = true;
    let error: string | undefined;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: await signBody(secret, timestamp, delivery.payload),
          "x-lendloop-event-id": deliveryId,
        },
        body: delivery.payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      ok = res.ok;
      if (!ok) {
        retryable = res.status >= 500 || [404, 408, 429].includes(res.status);
        error = `n8n responded HTTP ${res.status}`;
      }
    } catch (e) {
      error = e instanceof Error ? `${e.name}: ${e.message}` : "network error";
    }

    await ctx.runMutation(internal.webhooks.recordAttempt, {
      deliveryId,
      ok,
      retryable,
      error,
    });
  },
});

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    ok: v.boolean(),
    retryable: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { deliveryId, ok, retryable, error }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || delivery.status !== "pending") return;
    const attempts = delivery.attempts + 1;

    if (ok) {
      await ctx.db.patch(deliveryId, {
        status: "delivered",
        attempts,
        deliveredAt: Date.now(),
        lastError: undefined,
      });
      return;
    }

    const lastError = error?.slice(0, 300);
    if (retryable && attempts < MAX_ATTEMPTS) {
      await ctx.db.patch(deliveryId, { attempts, lastError });
      await ctx.scheduler.runAfter(RETRY_BACKOFF_MS[attempts - 1], internal.webhooks.deliver, {
        deliveryId,
      });
    } else {
      // Terminal failure: surfaced on the admin dashboard, never silent.
      console.error(`Webhook delivery ${deliveryId} failed after ${attempts} attempt(s): ${lastError}`);
      await ctx.db.patch(deliveryId, { status: "failed", attempts, lastError });
    }
  },
});
