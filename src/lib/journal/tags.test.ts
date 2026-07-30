import assert from "node:assert/strict";
import test from "node:test";

import type { Tag } from "../types.ts";
import { journalTagsForOwner } from "./tags.ts";

test("journal tags exclude vocabularies owned by coached players", () => {
  const own: Tag = {
    id: "own",
    owner_id: "viewer",
    label: "Footwork",
    created_at: "2026-07-29T12:00:00Z",
  };
  const player: Tag = {
    id: "player",
    owner_id: "player-1",
    label: "Footwork",
    created_at: "2026-07-29T13:00:00Z",
  };

  assert.deepEqual(journalTagsForOwner([player, own], "viewer"), [own]);
});
