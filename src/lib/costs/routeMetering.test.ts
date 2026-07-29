import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = [
  ["lesson", "lesson_summary"],
  ["journal-ocr", "journal_ocr"],
  ["entry-image", "entry_image_validation"],
  ["feedback/assist", "feedback_triage"],
] as const;

for (const [route, operation] of routes) {
  test(`${route} records successful OpenAI response usage`, () => {
    const source = readFileSync(
      new URL(`../../app/api/${route}/route.ts`, import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /import \{ openAIUsageEvents, recordUsage \} from "@\/lib\/costs\/meter"/,
    );
    assert.match(source, new RegExp(`operation: "${operation}"`));
    assert.match(source, /usage: data\.usage/);
    assert.match(source, /await recordUsage\(openAIUsageEvents\(/);
  });
}

