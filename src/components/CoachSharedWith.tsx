"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deriveMatchTitleParts } from "@/lib/matchTitle";

/**
 * Everything one coach can see of yours, in one place, each line
 * removable (Adil, 2026-09-04).
 *
 * The Coaches section could already list the matches shared with a
 * CONNECTED coach and take one back. It said nothing about the journal
 * beyond a count, and nothing at all about a coach who had been invited
 * but had not accepted — so the head start you picked while sending the
 * invite was invisible from the moment you sent it.
 *
 * Both kinds of pending grant live here too, because from the player's
 * side they are one question: what does this person have? A queued match
 * (166) and an accepted match-scoped link are different rows and the same
 * sentence.
 *
 * Unsharing an entry clears the grant and KEEPS the attribution: the
 * lesson was still with them, and a coach losing access is not the same
 * as it never having happened. The same rule leave_coach follows.
 */

interface MatchLink {
  /** The accepted, match-scoped coach_links row — revoking it is the
   *  removal. Null for a match merely queued against an invite. */
  linkId: string | null;
  matchId: string;
}

interface SharedEntry {
  id: string;
  title: string;
  /** Attributed to them but never granted. Shown rather than hidden: the
   *  journal has their name on it, so a list that said "nothing shared"
   *  would contradict the journal one tap away. This is also the real
   *  reason a coach cannot see an entry the player thinks they sent. */
  shared: boolean;
}

export function CoachSharedWith({
  coachRefId,
  inviteId,
  matchLinks,
  allMatches,
  onChanged,
}: {
  /** The player_coaches row, which is what entries are attributed to. */
  coachRefId: string | null;
  /** A pending invite, whose queued matches count as "waiting for them". */
  inviteId: string | null;
  matchLinks: MatchLink[];
  /** They already see every match, so listing individual ones would be a
   *  list of things you cannot take back on its own. */
  allMatches: boolean;
  onChanged: () => void;
}) {
  const [queued, setQueued] = useState<MatchLink[]>([]);
  const [entries, setEntries] = useState<SharedEntry[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [queuedRes, entryRes] = await Promise.all([
      inviteId
        ? supabase
            .from("coach_invite_matches")
            .select("match_id")
            .eq("invite_id", inviteId)
        : Promise.resolve({ data: [] }),
      coachRefId
        ? supabase
            .from("lessons")
            .select("id, transcript, takeaways, shared_with_coach_at")
            .eq("coach_ref_id", coachRefId)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    const q = ((queuedRes.data as { match_id: string }[]) ?? []).map((r) => ({
      linkId: null,
      matchId: r.match_id,
    }));
    setQueued(q);
    setEntries(
      (
        (entryRes.data as {
          id: string;
          transcript: string;
          takeaways: { title?: string | null } | null;
          shared_with_coach_at: string | null;
        }[]) ?? []
      ).map((l) => {
        const words = (l.transcript ?? "").replace(/\s+/g, " ").trim();
        return {
          id: l.id,
          title:
            l.takeaways?.title?.trim() ||
            (words.length > 64 ? `${words.slice(0, 64)}…` : words) ||
            "Entry",
          shared: l.shared_with_coach_at !== null,
        };
      }),
    );

    const ids = [...new Set([...matchLinks, ...q].map((m) => m.matchId))];
    if (ids.length > 0) {
      const { data } = await supabase
        .from("matches")
        .select("id, opponent_name, venue, played_at")
        .in("id", ids);
      setNames(
        new Map(
          (data ?? []).map((m) => [
            m.id as string,
            deriveMatchTitleParts({
              opponentName: m.opponent_name as string | null,
              venue: m.venue as string | null,
              playedAt: m.played_at as string,
            }).primary,
          ]),
        ),
      );
    }
    // matchLinks is rebuilt by the parent on every refresh; keying the
    // effect on the ids rather than the array keeps this from looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachRefId, inviteId, matchLinks.map((m) => m.matchId).join(",")]);

  useEffect(() => {
    void load();
  }, [load]);

  const unshareMatch = async (m: MatchLink) => {
    setBusy(m.matchId);
    const supabase = createClient();
    if (m.linkId) {
      await supabase.from("coach_links").delete().eq("id", m.linkId);
    } else if (inviteId) {
      await supabase
        .from("coach_invite_matches")
        .delete()
        .eq("invite_id", inviteId)
        .eq("match_id", m.matchId);
    }
    await load();
    setBusy(null);
    onChanged();
  };

  /** Unsharing clears the grant and KEEPS the attribution, so the entry
   *  still says who taught it. Sharing is the same move backwards. */
  const setEntryShared = async (id: string, shared: boolean) => {
    setBusy(id);
    const supabase = createClient();
    await supabase
      .from("lessons")
      .update({
        shared_with_coach_at: shared ? new Date().toISOString() : null,
      })
      .eq("id", id);
    await load();
    setBusy(null);
    onChanged();
  };

  // A coach on "all matches" is already told so by the scope line right
  // above this, so listing it again here would print one sentence twice
  // two lines apart. Their journal half still needs saying.
  const shownMatches = allMatches ? [] : [...matchLinks, ...queued];

  if (allMatches && entries.length === 0) return null;
  if (!allMatches && shownMatches.length === 0 && entries.length === 0) {
    return (
      <p className="mt-3 text-sm text-zinc-500">
        You haven&apos;t shared anything with them yet.
      </p>
    );
  }

  const line = (
    key: string,
    label: string,
    sub: string | null,
    action: {
      label: string;
      busyLabel: string;
      warm: boolean;
      run: () => void;
    },
  ) => (
    <li key={key} className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block truncate text-sm text-zinc-300">{label}</span>
        {sub && <span className="block text-xs text-zinc-500">{sub}</span>}
      </span>
      <button
        type="button"
        onClick={action.run}
        disabled={busy === key}
        className={`shrink-0 rounded-full border px-3.5 py-1 text-sm font-medium transition-colors disabled:opacity-60 ${
          action.warm
            ? "border-cyan-500/40 text-cyan-200 hover:border-cyan-400/70"
            : "border-edge text-zinc-400 hover:border-amber-500/60 hover:text-amber-200"
        }`}
      >
        {busy === key ? action.busyLabel : action.label}
      </button>
    </li>
  );

  const remove = (run: () => void) => ({
    label: "Remove",
    busyLabel: "Removing…",
    warm: false,
    run,
  });

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {allMatches ? "Journal shared with them" : "What they can see"}
      </p>

      {!allMatches && shownMatches.length > 0 && (
        <ul className="mt-2">
          {shownMatches.map((m) =>
            line(
              m.matchId,
              names.get(m.matchId) ?? "Match",
              m.linkId ? null : "When they accept",
              remove(() => void unshareMatch(m)),
            ),
          )}
        </ul>
      )}

      {entries.length > 0 && (
        <ul className="mt-2">
          {entries.map((e) =>
            line(
              e.id,
              e.title,
              e.shared ? "Journal entry" : "Journal entry · not shared yet",
              e.shared
                ? remove(() => void setEntryShared(e.id, false))
                : {
                    label: "Share",
                    busyLabel: "Sharing…",
                    warm: true,
                    run: () => void setEntryShared(e.id, true),
                  },
            ),
          )}
        </ul>
      )}
    </div>
  );
}
