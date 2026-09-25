import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_UPLOAD_CHOICE,
  MARK_ON_OPEN_PARAM,
  selectedUploadChoice,
  uploadChoicePlan,
  uploadChoiceRows,
  uploadLanding,
  uploadProcessBody,
  uploadedMatchHref,
  wantsMarkerOnOpen,
  type UploadChoice,
} from "./uploadChoice.ts";

const CHOICES: UploadChoice[] = ["later", "automatic", "hand"];

test("Later is the default, every time", () => {
  assert.equal(DEFAULT_UPLOAD_CHOICE, "later");
  assert.deepEqual(uploadChoicePlan(DEFAULT_UPLOAD_CHOICE), {
    autoProcess: false,
    openMarker: false,
  });
});

test("the rows: Later, Automatically, then marking by hand only where the account has it", () => {
  assert.deepEqual(uploadChoiceRows(true), ["later", "automatic", "hand"]);
  assert.deepEqual(uploadChoiceRows(false), ["later", "automatic"]);
  // A hand choice with no hand row reads as Later, never as a hidden pick.
  assert.equal(selectedUploadChoice("hand", false), "later");
  assert.equal(selectedUploadChoice("hand", true), "hand");
  assert.equal(selectedUploadChoice("automatic", false), "automatic");
  assert.equal(selectedUploadChoice("later", true), "later");
});

test("each choice maps onto the old switch", () => {
  // Later is the switch off, Automatically is it on, and marking by hand
  // is off plus the marker.
  assert.deepEqual(uploadChoicePlan("later"), { autoProcess: false, openMarker: false });
  assert.deepEqual(uploadChoicePlan("automatic"), { autoProcess: true, openMarker: false });
  assert.deepEqual(uploadChoicePlan("hand"), { autoProcess: false, openMarker: true });
});

test("the automatic request is the switch's request", () => {
  assert.deepEqual(uploadProcessBody("m1", null), { matchId: "m1", placement: true });
  assert.deepEqual(uploadProcessBody("m1", { start: 12.5, end: 600 }), {
    matchId: "m1",
    placement: true,
    trimStartS: 12.5,
    trimEndS: 600,
  });
});

test("what the upload does when it lands", () => {
  const land = (choice: UploadChoice, committed: boolean, extra: Partial<{ orderId: string | null; matchId: string | null }> = {}) =>
    uploadLanding({ choice, committed, orderId: null, matchId: "m1", ...extra });

  // Only a pressed Automatically spends minutes.
  assert.deepEqual(land("automatic", true), { kind: "process" });
  assert.deepEqual(land("automatic", false), { kind: "library" });
  assert.deepEqual(land("later", true), { kind: "library" });
  assert.deepEqual(land("later", false), { kind: "library" });
  // Marking by hand spends nothing, so it goes to the marker either way.
  assert.deepEqual(land("hand", true), { kind: "marker", href: "/match/m1?mark=1" });
  assert.deepEqual(land("hand", false), { kind: "marker", href: "/match/m1?mark=1" });
  // No match row came back: nowhere to go.
  assert.deepEqual(land("hand", false, { matchId: null }), { kind: "library" });
  // A review order's upload never processes or marks here.
  for (const choice of CHOICES) {
    assert.deepEqual(land(choice, true, { orderId: "o1" }), { kind: "library" }, choice);
  }
});

test("the match page link carries the marker flag only for marking by hand", () => {
  assert.equal(uploadedMatchHref("m1", "later"), "/match/m1");
  assert.equal(uploadedMatchHref("m1", "automatic"), "/match/m1");
  assert.equal(uploadedMatchHref("m1", "hand"), `/match/m1?${MARK_ON_OPEN_PARAM}=1`);
  assert.equal(wantsMarkerOnOpen("?mark=1"), true);
  assert.equal(wantsMarkerOnOpen("mark=1"), true);
  assert.equal(wantsMarkerOnOpen("?x=2&mark=1"), true);
  assert.equal(wantsMarkerOnOpen(""), false);
  assert.equal(wantsMarkerOnOpen("?mark=0"), false);
});

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the upload card: one choice in place of the switch, Later by default", () => {
  const src = read("src/app/dashboard/UploadCard.tsx");
  assert.doesNotMatch(src, /Process when the upload finishes/);
  assert.doesNotMatch(src, /setAutoProcess|Its length in minutes comes off your balance/);
  // Later every time, and again for the next upload; never read back from
  // a pending upload or storage.
  assert.match(src, /useState<UploadChoice>\(DEFAULT_UPLOAD_CHOICE\)/);
  const sets = [...src.matchAll(/setChoice\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(sets, ["DEFAULT_UPLOAD_CHOICE", "DEFAULT_UPLOAD_CHOICE"]);
  assert.doesNotMatch(src, /localStorage[^\n]*choice|choice[^\n]*localStorage/i);

  const block = src.slice(src.indexOf("const processOptions ="), src.indexOf("  return (\n    <section"));
  assert.match(block, /<h3 className="text-sm text-zinc-200">Break it into points<\/h3>/);
  assert.match(block, /<WayChoice/);
  assert.match(block, /rows=\{uploadChoiceRows\(handCutEnabled\)\}/);
  assert.match(block, /onSelect=\{setChoice\}/);
  assert.match(block, /trailing=\{\{ automatic: quote != null \? `\$\{quote\} min` : null \}\}/);
  assert.match(block, /disabled=\{committed\}/);
  // Trim and the out-of-minutes recovery only while Automatically is selected.
  assert.match(block, /\{autoProcess && canTrim && durationS != null && localVideoUrl && \(/);
  assert.match(block, /\{autoProcess && autoState === "short" && \(\s*<AllowanceRecovery/);
  assert.equal(src.split("<AllowanceRecovery resource=\"minutes\"").length - 1, 1);

  // Changing the type never touches the choice (an explicit pick survives it).
  const types = src.slice(src.indexOf("{MATCH_TYPES.map((t) => ("), src.indexOf("{sideCard}"));
  assert.doesNotMatch(types, /setChoice|choice/i);

  // The landing goes through uploadLanding, and the link after it too.
  assert.match(src, /const landing = uploadLanding\(\{/);
  assert.match(src, /router\.push\(landing\.href\)/);
  assert.match(src, /href=\{uploadedMatchHref\(libraryMatchId, selectedChoice\)\}/);
  assert.match(src, /body: JSON\.stringify\(uploadProcessBody\(matchId, trimRef\.current\)\)/);
});

test("the section's wording, and nothing it must not say", () => {
  const ways = read("src/app/match/[id]/BreakIntoPoints.tsx");
  assert.match(ways, /later: "Later"/);
  assert.match(ways, /later: "Choose on the match page when you're ready\."/);
  const words = [
    "Break it into points",
    ...[...ways.matchAll(/^\s+(?:later|automatic|hand): "([^"]+)",$/gm)].map((m) => m[1]),
  ];
  assert.ok(words.length >= 7, words.join(" | "));
  for (const w of words) {
    assert.doesNotMatch(w, /process|free|\bMac\b|iPhone|phone|\bAI\b|—/i, w);
  }
});

test("the upload page asks the database whether the account marks by hand", () => {
  const page = read("src/app/upload/page.tsx");
  assert.match(page, /supabase\.rpc\("hand_cut_enabled", \{ p_user: user\.id \}\)/);
  assert.match(page, /handCutEnabled=\{handCut === true\}/);
});

test("the match page opens the marker once from the flag, then drops it", () => {
  const raw = read("src/app/match/[id]/RawMatchView.tsx");
  assert.match(raw, /wantsMarkerOnOpen\(window\.location\.search\)/);
  assert.match(raw, /url\.searchParams\.delete\(MARK_ON_OPEN_PARAM\)/);
  assert.match(raw, /window\.history\.replaceState\(/);
  const effect = raw.slice(raw.indexOf("const markOnArrival"), raw.indexOf("return (\n    <div"));
  // The flag comes off the address before anything else is decided.
  assert.ok(effect.indexOf("replaceState") < effect.indexOf("if (!markOnArrival.current) return;"));
  // A file this browser cannot play never opens the marker: the same error
  // that greys the Mark row, or metadata with no picture, drops the flag.
  assert.match(effect, /!isOwner \|\| !handCutEnabled \|\| !rawUrl \|\| undecodable \|\| hasPicture === false\s*\|\| sourceGone \|\| jobRunning/);
  assert.match(raw, /handDisabled: !rawUrl \|\| undecodable,/);
  // It waits for the draft AND for the player to prove the file plays.
  assert.match(effect, /if \(!handCutReady \|\| hasPicture !== true\) return;/);
  assert.match(raw, /if \(v\) setHasPicture\(v\.videoWidth > 0 && v\.videoHeight > 0\);/);
  assert.match(raw, /onLoadedMetadata=\{onMetadata\}/);
  assert.match(raw, /onMediaError=\{\(\) => setUndecodable\(true\)\}/);
  assert.match(effect, /setPickedWay\("hand"\)/);
  assert.match(effect, /void openMarker\(\)/);
});
