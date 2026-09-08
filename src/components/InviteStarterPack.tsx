"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import {
  fetchPointsPaged,
  useScoreChips,
  type PointLite,
} from "@/app/dashboard/shared";

/**
 * What a coach finds waiting the day they accept (Adil, 2026-09-04).
 *
 * An invite used to hand over an empty room: the coach signed in and saw
 * a name. Everything the player had already recorded — matches they had
 * scored, lessons they had written up — was there the whole time and
 * nobody was shown it. Picking a few at the moment you invite someone is
 * the one point in the flow where you are already thinking about that
 * person, so it is the cheapest place to ask.
 *
 * Nothing here grants anything on its own. Matches become
 * coach_invite_matches rows, which the accept turns into real shares
 * (166); entries are attributed to the coach's row and marked shared,
 * which student_shared_lessons only honours once there is an accepted
 * link. Revoke the invite and all of it goes with it.
 */

export interface StarterMatch {
  id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string;
  status: string;
}

export interface StarterEntry {
  id: string;
  title: string;
  created_at: string;
  /** Already attributed to a DIFFERENT coach, so it cannot move. An entry
   *  records who taught it, and that is one person. */
  takenBy: string | null;
}

const LIMIT = 10;

export function useStarterPack(userId: string, open: boolean) {
  const [matches, setMatches] = useState<StarterMatch[]>([]);
  const [entries, setEntries] = useState<StarterEntry[]>([]);
  const [points, setPoints] = useState<PointLite[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [matchRes, lessonRes, coachRes] = await Promise.all([
      supabase
        .from("matches")
        .select("id, opponent_name, venue, played_at, status")
        .eq("user_id", userId)
        .eq("status", "ready")
        .order("played_at", { ascending: false })
        .limit(LIMIT),
      supabase
        .from("lessons")
        .select("id, transcript, takeaways, created_at, coach_ref_id")
        .neq("kind", "coach")
        .order("created_at", { ascending: false })
        .limit(LIMIT),
      supabase.rpc("player_coaches_list"),
    ]);

    const rows = (matchRes.data as StarterMatch[]) ?? [];
    setMatches(rows);
    if (rows.length > 0) {
      void fetchPointsPaged<PointLite>(
        "id, match_id, idx, t0, is_let, confirmed_winner, game_end_override, game_winner_override",
        rows.map((m) => m.id),
      ).then(setPoints);
    }

    const names = new Map<string, string>(
      ((coachRes.data as { id: string; display_name: string }[]) ?? []).map(
        (c) => [c.id, c.display_name],
      ),
    );
    setEntries(
      (
        (lessonRes.data as {
          id: string;
          transcript: string;
          takeaways: { title?: string | null } | null;
          created_at: string;
          coach_ref_id: string | null;
        }[]) ?? []
      ).map((l) => {
        const words = (l.transcript ?? "").replace(/\s+/g, " ").trim();
        return {
          id: l.id,
          title:
            l.takeaways?.title?.trim() ||
            (words.length > 60 ? `${words.slice(0, 60)}…` : words) ||
            "Entry",
          created_at: l.created_at,
          takenBy: l.coach_ref_id ? (names.get(l.coach_ref_id) ?? null) : null,
        };
      }),
    );
  }, [userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return { matches, entries, points };
}

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function InviteStarterPack({
  matches,
  entries,
  points,
  pickedMatches,
  pickedEntries,
  onToggleMatch,
  onToggleEntry,
  disabled = false,
}: {
  matches: StarterMatch[];
  entries: StarterEntry[];
  points: PointLite[];
  pickedMatches: Set<string>;
  pickedEntries: Set<string>;
  onToggleMatch: (id: string) => void;
  onToggleEntry: (id: string) => void;
  disabled?: boolean;
}) {
  const scores = useScoreChips(points);
  // A few, with the rest a tap away. Ten of each in one column makes a
  // sheet taller than the window, and capping the lists with their own
  // scrollbars just moves the problem into a nested scroller that eats
  // the page's wheel events.
  const [allMatches, setAllMatches] = useState(false);
  const [allEntries, setAllEntries] = useState(false);
  const PREVIEW = 4;
  if (matches.length === 0 && entries.length === 0) return null;

  const row = (
    key: string,
    picked: boolean,
    onClick: () => void,
    title: string,
    sub: string,
    trailing?: React.ReactNode,
    blocked?: string | null,
  ) => (
    <button
      key={key}
      type="button"
      role="checkbox"
      aria-checked={picked}
      disabled={disabled || !!blocked}
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors disabled:cursor-default ${
        blocked ? "opacity-50" : "hover:bg-surface-2"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
          picked
            ? "border-cyan-glow bg-cyan-glow text-ink"
            : "border-edge text-transparent"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m5 13 4 4 10-10"
          />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-200">{title}</span>
        <span className="block truncate text-xs text-zinc-500">
          {blocked ?? sub}
        </span>
      </span>
      {trailing}
    </button>
  );

  return (
    /* A step inside "Invite another coach", not a section beside it. It
       used to carry the same uppercase eyebrow as the section header
       above it — same size, weight, case and colour — so the two read as
       peers and the head start looked like it had escaped (Adil,
       2026-09-04). Sentence case, a rule above it, and it sits where it
       belongs. */
    <div className="mt-4 border-t border-edge/60 pt-4">
      <p className="text-sm font-semibold text-zinc-200">
        Give them a head start
      </p>
      <p className="mt-0.5 text-sm text-zinc-400">
        Anything you pick is waiting for them the moment they accept.
      </p>

      {matches.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-zinc-500">Recent matches</p>
          <div className="divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-surface-2/40">
            {(allMatches ? matches : matches.slice(0, PREVIEW)).map((m) => {
              const score = scores.get(m.id);
              return row(
                m.id,
                pickedMatches.has(m.id),
                () => onToggleMatch(m.id),
                deriveMatchTitleParts({
                  opponentName: m.opponent_name,
                  venue: m.venue,
                  playedAt: m.played_at,
                }).primary,
                [shortDay(m.played_at), m.venue].filter(Boolean).join(" · "),
                score ? (
                  <span className="shrink-0 rounded-full border border-edge bg-ink/50 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-300">
                    {score.you}
                    <span className="text-zinc-600">–</span>
                    {score.them}
                  </span>
                ) : null,
              );
            })}
          </div>
          {matches.length > PREVIEW && (
            <button
              type="button"
              onClick={() => setAllMatches((v) => !v)}
              className="mt-1.5 text-sm font-medium text-cyan-glow"
            >
              {allMatches ? "Show fewer" : `Show all ${matches.length} matches`}
            </button>
          )}
        </div>
      )}

      {entries.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-zinc-500">Recent journal entries</p>
          <div className="divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-surface-2/40">
            {(allEntries ? entries : entries.slice(0, PREVIEW)).map((e) =>
              row(
                e.id,
                pickedEntries.has(e.id),
                () => onToggleEntry(e.id),
                e.title,
                shortDay(e.created_at),
                null,
                // An entry records who taught it, and that is one person.
                // Saying whose rather than hiding the row means the list
                // still matches the journal they remember.
                e.takenBy ? `Already with ${e.takenBy}` : null,
              ),
            )}
          </div>
          {entries.length > PREVIEW && (
            <button
              type="button"
              onClick={() => setAllEntries((v) => !v)}
              className="mt-1.5 text-sm font-medium text-cyan-glow"
            >
              {allEntries ? "Show fewer" : `Show all ${entries.length} entries`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
