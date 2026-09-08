import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (name: string) =>
  readFileSync(join(process.cwd(), "src/app/match/[id]", name), "utf8");

test("match tools keep analysis, placement, links, coach, and files distinct", () => {
  const matchView = read("MatchView.tsx");
  const reelBar = read("ReelBar.tsx");
  const shareSheet = readFileSync(
    join(process.cwd(), "src/components/ShareSheet.tsx"),
    "utf8",
  );
  const shareWithCoach = readFileSync(
    join(process.cwd(), "src/components/ShareWithCoach.tsx"),
    "utf8",
  );

  assert.match(matchView, />Share a link</);
  assert.ok(
    matchView.indexOf(">Match analysis<") <
      matchView.indexOf("<PlacementToolsRow"),
  );
  assert.ok(
    matchView.indexOf("<AnalysisCards") <
      matchView.indexOf("<PlacementAggregate"),
  );
  assert.doesNotMatch(reelBar, /Instagram Reel/);
  assert.doesNotMatch(shareSheet, /With your coach/);
  assert.match(shareSheet, /This match/);
  assert.match(shareSheet, /Highlights/);
  assert.match(shareSheet, /Starred points/);
  assert.ok(
    shareWithCoach.indexOf("Give them a head start") <
      shareWithCoach.indexOf("Create invite link"),
  );
});
