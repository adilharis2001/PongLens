import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { verifySvixSignature, svixTimestampFresh } from "./svix.ts";

const SECRET = "whsec_" + Buffer.from("a-test-signing-key-32-bytes-long").toString("base64");
const ID = "msg_2abcXYZ";
const TS = "1786000000";
const BODY = '{"type":"email.bounced","data":{"to":["a@b.com"]}}';

function sign(secret: string, id: string, ts: string, body: string): string {
  const raw = secret.slice("whsec_".length);
  const mac = createHmac("sha256", Buffer.from(raw, "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return `v1,${mac}`;
}

test("a correctly signed delivery verifies", () => {
  const header = sign(SECRET, ID, TS, BODY);
  assert.equal(verifySvixSignature(SECRET, ID, TS, BODY, header), true);
});

test("a tampered body is rejected", () => {
  const header = sign(SECRET, ID, TS, BODY);
  const tampered = BODY.replace("a@b.com", "attacker@evil.com");
  assert.equal(verifySvixSignature(SECRET, ID, TS, tampered, header), false);
});

test("a signature from a different secret is rejected", () => {
  const other = "whsec_" + Buffer.from("a-different-key-of-the-same-size").toString("base64");
  const header = sign(other, ID, TS, BODY);
  assert.equal(verifySvixSignature(SECRET, ID, TS, BODY, header), false);
});

test("replaying a signature under a different id is rejected", () => {
  const header = sign(SECRET, ID, TS, BODY);
  assert.equal(verifySvixSignature(SECRET, "msg_other", TS, BODY, header), false);
});

test("rotation: one matching signature among several passes", () => {
  const stale = sign(SECRET, ID, "1", BODY);
  const good = sign(SECRET, ID, TS, BODY);
  assert.equal(
    verifySvixSignature(SECRET, ID, TS, BODY, `${stale} ${good}`),
    true,
  );
});

test("a header with no v1 entries is rejected", () => {
  assert.equal(verifySvixSignature(SECRET, ID, TS, BODY, "v2,whatever"), false);
  assert.equal(verifySvixSignature(SECRET, ID, TS, BODY, ""), false);
});

test("an empty secret cannot verify anything", () => {
  const header = sign(SECRET, ID, TS, BODY);
  assert.equal(verifySvixSignature("whsec_", ID, TS, BODY, header), false);
});

test("timestamps inside the tolerance are fresh", () => {
  const now = 1786000000_000;
  assert.equal(svixTimestampFresh("1786000000", now), true);
  assert.equal(svixTimestampFresh("1785999800", now), true);
});

test("a replayed timestamp outside the tolerance is stale", () => {
  const now = 1786000000_000;
  assert.equal(svixTimestampFresh("1785999000", now), false);
  assert.equal(svixTimestampFresh("1786001000", now), false);
});

test("a non-numeric timestamp is stale", () => {
  assert.equal(svixTimestampFresh("not-a-number", 1786000000_000), false);
  assert.equal(svixTimestampFresh("", 1786000000_000), false);
});
