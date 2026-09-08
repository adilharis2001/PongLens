import assert from "node:assert/strict";
import test from "node:test";
import {
  highlightShareCanBeCreated,
  highlightShareMediaKey,
} from "./highlightShare.ts";

const matchId = "00000000-0000-0000-0000-000000000001";

test("a highlight link can be created only for a finished reel", () => {
  assert.equal(
    highlightShareCanBeCreated({
      status: "ready",
      r2_key: `reels/${matchId}-highlights-abcdef0123456789.mp4`,
    }),
    true,
  );
  assert.equal(
    highlightShareCanBeCreated({
      status: "rendering",
      r2_key: `reels/${matchId}-highlights-abcdef0123456789.mp4`,
    }),
    false,
  );
  assert.equal(highlightShareCanBeCreated(null), false);
});

test("a public token can sign only its match's automatic highlight file", () => {
  assert.equal(
    highlightShareMediaKey(matchId, {
      match_id: matchId,
      r2_key: `reels/${matchId}-highlights-abcdef0123456789.mp4`,
    }),
    `reels/${matchId}-highlights-abcdef0123456789.mp4`,
  );
  assert.equal(
    highlightShareMediaKey(matchId, {
      match_id: "00000000-0000-0000-0000-000000000002",
      r2_key: `reels/${matchId}-highlights-abcdef0123456789.mp4`,
    }),
    null,
  );
  assert.equal(
    highlightShareMediaKey(matchId, {
      match_id: matchId,
      r2_key: `reels/00000000-0000-0000-0000-000000000002-highlights-abcdef0123456789.mp4`,
    }),
    null,
  );
});
