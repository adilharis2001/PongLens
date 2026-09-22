import assert from "node:assert/strict";
import test from "node:test";
import {
  SELECTION_LINK_MAX_POINTS,
  SELECTION_VIDEO_MAX_POINTS,
  selectionPointIds,
  selectionVideoCapS,
  selectionVideoTooLong,
} from "./starredSelection.ts";

const A = "a2e61027-2ee9-4026-a058-dc07441ee633";
const B = "E84A6675-1111-4222-8333-444455556666";

test("ids keep the order picked, lower-cased, a repeat kept once", () => {
  assert.deepEqual(selectionPointIds([B, A, B.toLowerCase()], 10), [
    B.toLowerCase(),
    A,
  ]);
});

test("anything that is not a list of ids is refused whole", () => {
  assert.equal(selectionPointIds(undefined, 10), null);
  assert.equal(selectionPointIds([], 10), null);
  assert.equal(selectionPointIds(A, 10), null);
  assert.equal(selectionPointIds([A, "not-an-id"], 10), null);
  assert.equal(selectionPointIds([A, 7], 10), null);
});

test("each kind of share has its own ceiling", () => {
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
  assert.equal(
    selectionPointIds(ids(SELECTION_VIDEO_MAX_POINTS), SELECTION_VIDEO_MAX_POINTS)
      ?.length,
    60,
  );
  assert.equal(
    selectionPointIds(ids(SELECTION_VIDEO_MAX_POINTS + 1), SELECTION_VIDEO_MAX_POINTS),
    null,
  );
  assert.equal(
    selectionPointIds(ids(SELECTION_LINK_MAX_POINTS), SELECTION_LINK_MAX_POINTS)
      ?.length,
    100,
  );
});

test("Instagram takes a minute, a saved video three", () => {
  assert.equal(selectionVideoCapS("instagram"), 60);
  assert.equal(selectionVideoCapS("save"), 180);
  assert.equal(selectionVideoTooLong(60.4, "instagram"), false);
  assert.equal(selectionVideoTooLong(61, "instagram"), true);
  assert.equal(selectionVideoTooLong(61, "save"), false);
  assert.equal(selectionVideoTooLong(181, "save"), true);
});
