import assert from "node:assert/strict";
import test from "node:test";
import * as highlightShare from "./highlightShare.ts";

const matchId = "00000000-0000-0000-0000-000000000001";

test("a highlight link can be created only for a finished reel", () => {
  assert.equal(
    highlightShare.highlightShareCanBeCreated({
      status: "ready",
      r2_key: `reels/${matchId}-highlights-abcdef0123456789.mp4`,
    }),
    true,
  );
  assert.equal(
    highlightShare.highlightShareCanBeCreated({
      status: "rendering",
      r2_key: `reels/${matchId}-highlights-abcdef0123456789.mp4`,
    }),
    false,
  );
  assert.equal(highlightShare.highlightShareCanBeCreated(null), false);
});

test("a public token can sign only its match's automatic highlight file", () => {
  assert.equal(
    highlightShare.highlightShareMediaKey(matchId, {
      match_id: matchId,
      r2_key: `reels/${matchId}-highlights-abcdef0123456789.mp4`,
    }),
    `reels/${matchId}-highlights-abcdef0123456789.mp4`,
  );
  assert.equal(
    highlightShare.highlightShareMediaKey(matchId, {
      match_id: "00000000-0000-0000-0000-000000000002",
      r2_key: `reels/${matchId}-highlights-abcdef0123456789.mp4`,
    }),
    null,
  );
  assert.equal(
    highlightShare.highlightShareMediaKey(matchId, {
      match_id: matchId,
      r2_key: `reels/00000000-0000-0000-0000-000000000002-highlights-abcdef0123456789.mp4`,
    }),
    null,
  );
});

test("versioned highlight attempts remain shareable without widening the match boundary", () => {
  const otherMatch = "00000000-0000-0000-0000-000000000002";
  for (const version of ["40000000-0000-4000-8000-000000000004", "4000000000004000"]) {
    const suffix = `v-${version}-highlights-abcdef0123456789-0123456789abcdef0123456789abcdef.mp4`;
    const key = `reels/${matchId}-${suffix}`;
    assert.equal(highlightShare.highlightShareMediaKey(matchId, { match_id: matchId, r2_key: key }), key);
    assert.equal(highlightShare.highlightShareMediaKey(matchId, { match_id: otherMatch, r2_key: key }), null);
    assert.equal(highlightShare.highlightShareMediaKey(matchId, { match_id: matchId, r2_key: `reels/${otherMatch}-${suffix}` }), null);
    for (const malformed of [key + ".bak", key.replace(".mp4", ".mov"), key.replace("-highlights-", "-full-"), key.replace(version, "../other")]) {
      assert.equal(highlightShare.highlightShareMediaKey(matchId, { match_id: matchId, r2_key: malformed }), null);
    }
  }
});

test("a public highlight timeline accepts only safe ordered rows", () => {
  const pointId = "00000000-0000-0000-0000-000000000001";
  assert.deepEqual(
    highlightShare.sanitizeHighlightTimeline([
      { point_id: pointId, output_start_s: "7.7", output_end_s: "18" },
      { point_id: pointId, output_start_s: 0, output_end_s: 8 },
    ]),
    [
      { point_id: pointId, output_start_s: 0, output_end_s: 8 },
      { point_id: pointId, output_start_s: 7.7, output_end_s: 18 },
    ],
  );
});

test("a malformed public highlight timeline cannot drive the scoreboard", () => {
  const pointId = "00000000-0000-0000-0000-000000000001";
  assert.deepEqual(
    highlightShare.sanitizeHighlightTimeline([
      { point_id: "not-a-uuid", output_start_s: 0, output_end_s: 8 },
      { point_id: pointId, output_start_s: -1, output_end_s: 8 },
      { point_id: pointId, output_start_s: 9, output_end_s: 8 },
      { point_id: pointId, output_start_s: "nan", output_end_s: 8 },
      null,
    ]),
    [],
  );
  assert.deepEqual(highlightShare.sanitizeHighlightTimeline({}), []);
});
