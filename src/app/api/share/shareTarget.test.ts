import assert from "node:assert/strict";
import test from "node:test";
import { matchShareKind } from "./shareTarget.ts";

test("highlights are a distinct match share target", () => {
  assert.equal(
    matchShareKind({ pointId: "", tagId: "", requestedKind: "highlights" }),
    "highlights",
  );
  assert.equal(
    matchShareKind({
      pointId: "00000000-0000-0000-0000-000000000001",
      tagId: "",
      requestedKind: "highlights",
    }),
    null,
  );
});

test("existing match share targets retain their meaning", () => {
  assert.equal(
    matchShareKind({ pointId: "", tagId: "", requestedKind: "" }),
    "match",
  );
  assert.equal(
    matchShareKind({ pointId: "point", tagId: "", requestedKind: "" }),
    "point",
  );
  assert.equal(
    matchShareKind({ pointId: "", tagId: "tag", requestedKind: "tag" }),
    "tag",
  );
});
