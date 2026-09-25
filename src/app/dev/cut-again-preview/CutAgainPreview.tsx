"use client";

import { useMemo, useState } from "react";
import type { Match } from "@/lib/types";
import { MarkPoints } from "@/app/match/[id]/MarkPoints";
import { normalizeMarks, openingMode, type CutMode } from "@/app/match/[id]/handCut";
import { tracksServe } from "@/lib/matchTitle";
import { RecutChoice } from "@/app/match/[id]/recut/RecutChoice";
import {
  readRecutOptions,
  recutChoiceView,
  type RecutChoice as Choice,
} from "@/app/match/[id]/recut/recutView";
import type { PreviewPoint } from "./page";

/** The current cut's points as the marks start_recut would write. */
function prefill(points: PreviewPoint[]) {
  return normalizeMarks(
    points
      .filter((p) => !p.deleted && p.t0 != null && p.t1 != null)
      .map((p) => ({
        id: p.id,
        t0: p.t0,
        t1: p.t1,
        winner: p.confirmed_winner,
        isLet: p.is_let,
        starred: p.starred,
        tap: null,
        rate: null,
      })),
  );
}

export function CutAgainPreview({
  params,
  match,
  rawUrl,
  points,
}: {
  params: Record<string, string | undefined>;
  match: Match;
  rawUrl: string | null;
  points: PreviewPoint[];
  userId: string;
}) {
  const scene = params.scene ?? "marker";
  const all = useMemo(() => prefill(points), [points]);
  const marks = useMemo(() => {
    const which = params.marks ?? "all";
    if (which === "none") return [];
    if (which.startsWith("first=")) return all.slice(0, Number(which.slice(6)) || 0);
    return all;
  }, [all, params.marks]);
  const scoringAllowed = tracksServe(match.match_type);
  const recorded: CutMode | null =
    params.mode === "cut" || params.mode === "score" ? params.mode : null;
  const [open, setOpen] = useState(true);
  // Marking a processed match again (the default here): Start again at the
  // gate and the choice in the review sheet, as More options opens it.
  const recut = params.recut !== "0";
  const options = readRecutOptions({
    available: true,
    reason: null,
    replace_by_hand: params.coach !== "1",
    replace_automatic: false,
    has_coach_review: params.coach === "1",
    has_match_notes: params.notes === "1",
    cut_source: match.cut_source ?? "auto",
  });
  const [pick, setPick] = useState<Choice | null>(params.choice === "replace" ? "replace" : null);

  if (scene === "marker") {
    if (!rawUrl) return <p className="p-8 text-zinc-400">No original for this match.</p>;
    if (!open)
      return (
        <button type="button" className="m-8 rounded-full border border-edge px-4 py-2 text-sm" onClick={() => setOpen(true)}>
          Reopen the marker
        </button>
      );
    return (
      <MarkPoints
        rawUrl={rawUrl}
        durationS={match.duration_s ?? null}
        firstServer={(match.first_server as "user" | "opponent" | null) ?? null}
        matchType={match.match_type}
        onFirstServer={() => undefined}
        youLabel="Me"
        themLabel={(match.opponent_name ?? "Them").trim().split(/\s+/)[0].slice(0, 12)}
        initialMarks={marks}
        startMode={openingMode(marks, recorded, scoringAllowed)}
        saveDraft={async () => "saved"}
        submit={async () => "Preview only. Nothing was sent."}
        onClose={() => setOpen(false)}
        canStartAgain={recut}
        reviewChoice={
          recut ? (
            <RecutChoice name="preview" view={recutChoiceView("hand", options, pick)} onChange={setPick} />
          ) : undefined
        }
      />
    );
  }

  return <p className="p-8 text-zinc-400">Unknown scene.</p>;
}
