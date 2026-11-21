/**
 * HMAC-SHA256 request signing shared by both integration directions.
 *
 *   X-LendLoop-Timestamp: <unix seconds>
 *   X-LendLoop-Signature: sha256=<hex(HMAC(secret, `${timestamp}.${rawBody}`))>
 *
 * The timestamp is part of the signed string, and receivers reject requests
 * outside a 5 minute window, which bounds replay attacks.
 */

export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const SIGNATURE_HEADER = "x-lendloop-signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signBody(secret: string, timestamp: string, body: string) {
  return `sha256=${await hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/** Constant-time string comparison (length is not secret here). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifySignature(args: {
  secret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowMs?: number;
}): Promise<VerifyResult> {
  const { secret, timestamp, signature, body } = args;
  if (!secret) return { ok: false, reason: "receiver not configured" };
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "malformed timestamp" };

  const nowSec = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const expected = await signBody(secret, timestamp, body);
  return timingSafeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}
