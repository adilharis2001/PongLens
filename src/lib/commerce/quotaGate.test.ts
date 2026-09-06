import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkUploadAllowed, QUOTA_ERRORS } from "../quota.ts";

function client(used: number, limit: number, error = false): SupabaseClient {
  return { rpc: () => ({ single: async () => ({
    data: error ? null : { used_bytes: used, storage_limit_bytes: limit, active_jobs: 0, uploads_today: 0, daily_upload_limit: 3 },
    error: error ? { message: "unavailable" } : null,
  }) }) } as unknown as SupabaseClient;
}
test("a full account cannot import a video of initially unknown size", async () => {
  assert.equal(await checkUploadAllowed(client(10, 10), 0), QUOTA_ERRORS.storage);
});
test("uploads fit within the remaining storage allowance", async () => {
  assert.equal(await checkUploadAllowed(client(8, 10), 2), null);
  assert.equal(await checkUploadAllowed(client(8, 10), 3), QUOTA_ERRORS.storage);
});
test("a failed storage lookup cannot grant upload access", async () => {
  assert.equal(await checkUploadAllowed(client(0, 10, true), 1), QUOTA_ERRORS.unavailable);
});
