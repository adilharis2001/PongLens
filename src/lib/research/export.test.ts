import assert from "node:assert/strict";
import test from "node:test";
import { researchExportFilename } from "./export.ts";

test("research export filename uses a safe batch slug", () => {
  assert.equal(
    researchExportFilename({
      batch: { slug: "serve-detection-cross-match-v1" },
    }),
    "serve-detection-cross-match-v1.json",
  );
  assert.equal(
    researchExportFilename({
      batch: { slug: "../../Private Batch!" },
    }),
    "private-batch.json",
  );
});

test("research export filename has a stable fallback", () => {
  assert.equal(researchExportFilename(null), "ponglens-research-export.json");
  assert.equal(
    researchExportFilename({ batch: { slug: "" } }),
    "ponglens-research-export.json",
  );
});
