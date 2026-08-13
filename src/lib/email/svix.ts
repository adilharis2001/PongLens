import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Svix signature verification, which is how Resend signs webhook
 * deliveries (104).
 *
 * Kept in its own module with no "server-only" import so it can be tested
 * directly, the way meter.ts is. This is the code standing between the
 * open internet and a table the send path trusts, so it is the one part
 * of the webhook that should not go unexercised.
 *
 * Verified by hand rather than by adding the svix package: the whole
 * scheme is an HMAC over three concatenated strings, and this codebase
 * already talks to Resend with raw fetch instead of their SDK.
 */

const TOLERANCE_SECONDS = 5 * 60;

/**
 * The signed content is `<id>.<timestamp>.<raw body>`. The body must be
 * the bytes as received: JSON.parse followed by JSON.stringify reorders
 * keys and the signature stops matching.
 */
export function verifySvixSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  const raw = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  const keyBytes = Buffer.from(raw, "base64");
  if (keyBytes.length === 0) return false;

  const expected = createHmac("sha256", keyBytes)
    .update(`${svixId}.${svixTimestamp}.${body}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  // The header carries a space-separated list so Svix can rotate secrets
  // without downtime: "v1,<sig> v1,<older sig>". Any one matching passes.
  return signatureHeader
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .map((part) => Buffer.from(part.slice("v1,".length)))
    .some(
      (given) =>
        given.length === expectedBuf.length &&
        timingSafeEqual(given, expectedBuf),
    );
}

/** A correctly signed delivery replayed an hour later is not a delivery. */
export function svixTimestampFresh(
  svixTimestamp: string,
  nowMs: number = Date.now(),
): boolean {
  const sent = Number(svixTimestamp);
  if (!Number.isFinite(sent)) return false;
  return Math.abs(nowMs / 1000 - sent) <= TOLERANCE_SECONDS;
}
