import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const path = "supabase/migrations/20260907212000_match_processing_versions.sql";
const sql = existsSync(path) ? readFileSync(path, "utf8") : "";
test("version migration installs the version identities and admin lifecycle boundaries", () => {
  for (const name of ["match_processing_versions", "active_processing_version_id", "processing_version_id", "admin_start_match_reprocess", "admin_publish_match_version", "admin_keep_current_match_version", "admin_restore_match_version"]) assert.ok(sql.includes(name), name);
  assert.match(sql, /deferrable initially deferred/i);
  assert.match(sql, /unique.*processing_version_id.*idx/i);
});
test("version migration covers the existing edit, share and dependent-write entry points", () => {
  for (const name of ["adjust_point", "split_point", "unsplit_point", "insert_point", "merge_points", "set_server_override", "request_reclip", "enqueue_reel", "enqueue_tag_reel", "notes", "point_tags", "review_findings", "share_links", "resolve_share_link", "resolve_share_points"]) assert.ok(sql.includes(name), name);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(points|notes|point_tags|share_links|review_findings)\b/i);
});
