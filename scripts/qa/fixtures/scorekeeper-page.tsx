"use client";

// Synthetic, local-only fixture. Copy to src/app/qa-scorekeeper/page.tsx
// for browser QA, then remove that temporary route before committing.
import { MatchView } from "@/app/match/[id]/MatchView";
import type { Match, Point } from "@/lib/types";
import { useSearchParams } from "next/navigation";

const owner = "11111111-1111-4111-8111-111111111111";
const matchId = "22222222-2222-4222-8222-222222222222";
const match: Match = {
  id: matchId, user_id: owner, job_id: null, opponent_name: "Alex",
  venue: null, match_type: "match", played_at: "2026-09-11T12:00:00Z",
  cut_path: "fixture-cut.mp4", match_json_path: null, thumb_path: null,
  status: "ready", user_side: "near", player_near_name: "Me",
  player_far_name: "Alex", first_server: "user", first_server_source: "user",
  match_structure: null, story_crop: null, clip_pads: {pre: 1, post: 1},
  placement_status: "not_requested", placement_retry_count: 0,
  placement_mapped_points: 0, placement_failure_code: null,
  placement_retry_expires_at: null, placement_retry_job_id: null,
  placement_generation_job_id: null, created_at: "2026-09-11T12:00:00Z",
};
const points: Point[] = [0, 1, 2].map((index) => ({
  id: `33333333-3333-4333-8333-${String(index + 1).padStart(12,"0")}`,
  match_id: matchId, idx: index + 1, t0: index * 9 + 1, t1: index * 9 + 7,
  cut_t0: index * 9, clip_path: "fixture-cut.mp4", server: "user",
  server_override: null, is_let: false, placement: null, suggestion: null,
  confirmed_winner: index === 0 ? "user" : null,
  scored_at_cut_s: index === 0 ? 6 : null, rally_end_cut_s: null,
  confirmed_how: null, starred: false, deleted: false, edited: false,
  tight_start: false, tight_end: false, game_end_override: null,
  game_winner_override: null, side_change_dismissed: false,
}));

export default function ScorekeeperFixture() {
  const params = useSearchParams();
  const missingClip = params.get("case") === "missing-clip";
  const keepScoreFullCard = params.get("full-card") !== "off";
  const fixturePoints = missingClip ? points.map((p,index) => index === 1
    ? {...p,idx:4,t0:10,t1:16,cut_t0:8}
    : index === 2 ? {...p,idx:2,t0:16,t1:22,cut_t0:10} : p) : points;
  return <MatchView key={String(missingClip)} match={match} initialPoints={fixturePoints} initialNotes={[]}
    userId={owner} accountName="Me" ownerName="Me" strictness="normal"
    noteAuthors={[]} initialTags={[]} initialPointTags={[]}
    ends={{
      tapEnd: true,
      rallyEnd: {on: false, bufferS: 0.5, tightBufferS: null, respectsCard: true},
      keepScoreFullCard,
    }} hasOriginal={false} />;
}
