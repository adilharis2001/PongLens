import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyR2Operation,
  r2OperationEvent,
} from "./r2Operations.ts";

test("R2 operations map to the vendor billing classes", () => {
  for (const operation of [
    "put_object",
    "create_multipart_upload",
    "upload_part",
    "complete_multipart_upload",
  ] as const) {
    assert.equal(classifyR2Operation(operation), "class_a_operation");
  }
  for (const operation of [
    "list_parts",
    "list_objects",
    "head_object",
    "get_object",
  ] as const) {
    assert.equal(classifyR2Operation(operation), "class_b_operation");
  }
  assert.equal(classifyR2Operation("delete_object"), null);
  assert.equal(classifyR2Operation("abort_multipart_upload"), null);
});

test("R2 event contains billing class but no bucket or object key", () => {
  const event = r2OperationEvent({
    operation: "put_object",
    idempotencyKey: "opaque-hash",
  });

  assert.equal(event?.provider, "Cloudflare");
  assert.equal(event?.unit, "class_a_operation");
  assert.equal(event?.quantity, 1);
  assert.deepEqual(event?.metadata, { storage_class: "standard" });
  assert.equal("bucket" in (event?.metadata ?? {}), false);
  assert.equal("object_key" in (event?.metadata ?? {}), false);
});

test("free delete operations do not create usage events", () => {
  assert.equal(
    r2OperationEvent({
      operation: "delete_object",
      idempotencyKey: "opaque-hash",
    }),
    null,
  );
});
