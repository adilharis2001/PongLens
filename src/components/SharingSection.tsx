"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShareWithCoach } from "@/components/ShareWithCoach";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import type { CoachLinkRow } from "@/lib/types";
import {
  entryCountLabel,
  mergeCandidates,
  type PlayerCoach,
} from "@/lib/coaches/playerCoaches";

/**
 * Player-side sharing, modelled as PEOPLE, not links. Each accepted coach is
 * one row with a scope summary ("All matches" or "N matches") no matter how
 * many underlying coach_links back it — so sharing many matches with one
 * coach stays a single row. Expanding a coach reveals their access — all
 * matches, or only the ones shared from a match page — switchable either
 * way without removing them (161), the per-match shares (each revocable)
 * and "Remove coach". Outstanding invites collapse into one quiet "N
 * waiting" line. Primary action is a compact "Add a coach".
 */

interface CoachGroup {
  key: string;
  coachId: string | null;
  name: string;
  email: string | null;
  links: CoachLinkRow[];
  /** A connection row (scope null) carrying every match. */
  watchesAll: boolean;
  /** distinct match ids this coach is scoped to (excludes the all-scope) */
  matchIds: string[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
        open ? "rotate-180" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function SharingSection({ userId }: { userId: string }) {
  const [links, setLinks] = useState<CoachLinkRow[] | null>(null);
  const [matchNames, setMatchNames] = useState<Map<string, string>>(new Map());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedCoach, setExpandedCoach] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  // The journal side of the same people (164): how many entries are
  // attributed to each, and which named rows are still unclaimed.
  const [journalCoaches, setJournalCoaches] = useState<PlayerCoach[]>([]);
  const [mergeFor, setMergeFor] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    const supabase = createClient();
    void supabase
      .rpc("player_coaches_list")
      .then(({ data: rows }) => setJournalCoaches((rows as PlayerCoach[]) ?? []));
    const { data } = await supabase.rpc("player_coach_links");
    const rows = (data ?? []) as CoachLinkRow[];
    setLinks(rows);
    const matchIds = [
      ...new Set(
        rows.map((l) => l.scope_match_id).filter((id): id is string => !!id)
      ),
    ];
    if (matchIds.length > 0) {
      const { data: matches } = await supabase
        .from("matches")
        .select("id, opponent_name, venue, played_at")
        .in("id", matchIds);
      setMatchNames(
        new Map(
          (matches ?? []).map((m) => [
            m.id as string,
            deriveMatchTitleParts({
              opponentName: m.opponent_name as string | null,
              venue: m.venue as string | null,
              playedAt: m.played_at as string,
            }).primary,
          ])
        )
      );
    }
  }, []);

  useEffect(() => {
    void fetchLinks();
  }, [fetchLinks]);

  const active = useMemo(
    () => (links ?? []).filter((l) => l.status !== "revoked"),
    [links]
  );
  const accepted = useMemo(
    () => active.filter((l) => l.status === "accepted"),
    [active]
  );
  const pending = useMemo(
    () => active.filter((l) => l.status === "pending"),
    [active]
  );

  const coaches = useMemo<CoachGroup[]>(() => {
    const map = new Map<string, CoachGroup>();
    for (const l of accepted) {
      const key = (l.coach_email ?? l.coach_name ?? l.id).toLowerCase();
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          coachId: l.coach_id,
          name: l.coach_name ?? l.coach_email ?? "Coach",
          email: l.coach_email,
          links: [],
          watchesAll: false,
          matchIds: [],
        };
        map.set(key, g);
      }
      g.links.push(l);
      if (l.scope_match_id === null) {
        if (l.all_matches) g.watchesAll = true;
      } else if (!g.matchIds.includes(l.scope_match_id))
        g.matchIds.push(l.scope_match_id);
    }
    return [...map.values()];
  }, [accepted]);

  const revokeLinks = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setError(null);
      setBusyIds((prev) => new Set([...prev, ...ids]));
      const supabase = createClient();
      // leave_coach (157) revokes every link with that coach AND clears the
      // roster binding, so their shared journal entries stop as well as
      // their match access. A plain status flip left the entries flowing.
      const { data: rows } = await supabase
        .from("coach_links")
        .select("coach_id")
        .in("id", ids);
      const coachIds = [
        ...new Set(
          ((rows as { coach_id: string | null }[]) ?? [])
            .map((r) => r.coach_id)
            .filter((c): c is string => Boolean(c)),
        ),
      ];
      let dbError: unknown = null;
      if (coachIds.length === 0) {
        // Pending invites nobody accepted yet carry no coach: flip them.
        ({ error: dbError } = await supabase
          .from("coach_links")
          .update({ status: "revoked" })
          .in("id", ids));
      } else {
        for (const coachId of coachIds) {
          const { error } = await supabase.rpc("leave_coach", {
            p_coach_id: coachId,
          });
          if (error) dbError = error;
        }
        // Links that hold no coach yet (pending) still need the flip.
        await supabase
          .from("coach_links")
          .update({ status: "revoked" })
          .in("id", ids)
          .is("coach_id", null);
      }
      setBusyIds((prev) => {
        const n = new Set(prev);
        ids.forEach((i) => n.delete(i));
        return n;
      });
      if (dbError) {
        setError("Couldn't update. Try again.");
        return;
      }
      void fetchLinks();
    },
    [fetchLinks]
  );

  /** The scope of an invite nobody has accepted yet (164).
   *
   *  set_coach_access refuses a pending link — it needs an accepted one to
   *  hang the connection off — so this writes the flag directly, which the
   *  player's own "manage own coach links" policy already allows. Without
   *  it the only way down from "all matches" before an invite is accepted
   *  was to revoke it and send a new link. */
  const setPendingScope = useCallback(
    async (link: CoachLinkRow, all: boolean) => {
      if (link.all_matches === all) return;
      setError(null);
      setBusyIds((prev) => new Set(prev).add(link.id));
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from("coach_links")
        .update({ all_matches: all })
        .eq("id", link.id);
      if (dbError) setError("Couldn't change it. Try again.");
      await fetchLinks();
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(link.id);
        return next;
      });
    },
    [fetchLinks],
  );

  /** Fold a coach the player named into the row an accept created, or the
   *  other way round (164). Needed because a name typed before an account
   *  arrives will not match the name on it: "Jonathan" and "Jonatan
   *  Mcdonald" are one man and two rows. */
  const mergeCoach = useCallback(
    async (into: string, from: string) => {
      setError(null);
      setMergeFor(null);
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("merge_player_coaches", {
        p_into: into,
        p_from: from,
      });
      if (rpcError) setError("Couldn't join them up. Try again.");
      await fetchLinks();
    },
    [fetchLinks],
  );

  const copyInvite = useCallback(async (link: CoachLinkRow) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/coach-invite/${link.invite_token}`
      );
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard blocked; nothing else to do
    }
  }, []);

  const scopeSummary = (g: CoachGroup) =>
    g.watchesAll
      ? "All matches"
      : g.matchIds.length === 0
        ? "No matches shared yet"
        : `${g.matchIds.length} match${g.matchIds.length === 1 ? "" : "es"}`;

  /** The per-coach setting (161). One RPC owns the rule for both platforms:
   *  it flips the connection row, or creates one for a pair that only ever
   *  had match-scoped shares. */
  const setAccess = useCallback(
    async (g: CoachGroup, all: boolean) => {
      if (!g.coachId || g.watchesAll === all) return;
      setError(null);
      setBusyIds((prev) => new Set(prev).add(g.key));
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("set_coach_access", {
        p_coach_id: g.coachId,
        p_all_matches: all,
      });
      if (rpcError) setError("Couldn't change their access. Try again.");
      await fetchLinks();
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(g.key);
        return next;
      });
    },
    [fetchLinks],
  );

  return (
    <section>
      {/* Heading with the action trailing on the same row — the section
          explains itself through its content, not a subtitle. Label style
          matches the account page's section labels. */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Coaches
        </h2>
        <ShareWithCoach
          userId={userId}
          onLinkCreated={fetchLinks}
          label="Add a coach"
          buttonClassName="rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white"
        />
      </div>

      {coaches.length > 0 && (
        <div className="mt-4 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {coaches.map((g) => {
            const open = expandedCoach === g.key;
            const allIds = g.links.map((l) => l.id);
            const removing = allIds.every((id) => busyIds.has(id));
            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => setExpandedCoach(open ? null : g.key)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-xs font-semibold text-cyan-glow">
                    {initials(g.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-200">
                      {g.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500">
                      {scopeSummary(g)}
                    </span>
                  </span>
                  <Chevron open={open} />
                </button>

                {open && (
                  <div className="border-t border-edge/60 bg-ink/30 px-4 py-3">
                    {g.email && (
                      <p className="truncate text-xs text-zinc-500">
                        {g.email}
                      </p>
                    )}
                    {/* The journal half of the same person (164). Match
                        access and attributed entries are two different
                        grants, so they are said separately rather than
                        rolled into one number. */}
                    {(() => {
                      const j = journalCoaches.find(
                        (x) => x.coach_id && x.coach_id === g.coachId,
                      );
                      if (!j) return null;
                      const spare = mergeCandidates(journalCoaches, j);
                      return (
                        <div className="mt-3">
                          <p className="text-sm text-zinc-300">
                            {entryCountLabel(j.entry_count)} in your journal
                            {j.shared_count > 0
                              ? `, ${j.shared_count} shared with them`
                              : ""}
                            .
                          </p>
                          {spare.length > 0 && (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setMergeFor(mergeFor === j.id ? null : j.id)
                                }
                                className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                              >
                                Same as an existing coach
                              </button>
                              {mergeFor === j.id && (
                                <ul className="mt-2 space-y-2">
                                  {spare.map((other) => (
                                    <li
                                      key={other.id}
                                      className="flex items-center justify-between gap-3"
                                    >
                                      <span className="min-w-0 truncate text-sm text-zinc-300">
                                        {other.display_name}
                                        <span className="text-zinc-500">
                                          {" · "}
                                          {entryCountLabel(other.entry_count)}
                                        </span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void mergeCoach(j.id, other.id)
                                        }
                                        className="shrink-0 rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
                                      >
                                        Join up
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(
                        [
                          [true, "All matches"],
                          [false, "Only matches I share"],
                        ] as const
                      ).map(([all, label]) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={g.watchesAll === all}
                          disabled={busyIds.has(g.key)}
                          onClick={() => void setAccess(g, all)}
                          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                            g.watchesAll === all
                              ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
                              : "border-edge text-zinc-300 hover:border-zinc-500 hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-sm text-zinc-300">
                      {g.watchesAll
                        ? "Watches all your matches, including future uploads."
                        : "Sees only the matches you share with them from a match page."}
                    </p>
                    {!g.watchesAll && g.matchIds.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {g.links
                          .filter((l) => l.scope_match_id)
                          .map((l) => (
                            <li
                              key={l.id}
                              className="flex items-center justify-between gap-3"
                            >
                              <span className="min-w-0 truncate text-sm text-zinc-300">
                                {matchNames.get(l.scope_match_id!) ?? "Match"}
                              </span>
                              <button
                                type="button"
                                onClick={() => void revokeLinks([l.id])}
                                disabled={busyIds.has(l.id)}
                                className="shrink-0 text-sm font-medium text-zinc-400 transition-colors hover:text-amber-200 disabled:opacity-60"
                              >
                                {busyIds.has(l.id) ? "Removing…" : "Remove"}
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={() => void revokeLinks(allIds)}
                      disabled={removing}
                      className="mt-4 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-60"
                    >
                      {removing ? "Removing…" : "Remove coach"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-edge bg-surface">
          <button
            type="button"
            onClick={() => setPendingOpen((v) => !v)}
            aria-expanded={pendingOpen}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 text-zinc-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            <span className="flex-1 text-sm text-zinc-400">
              {pending.length} invite{pending.length === 1 ? "" : "s"} waiting to
              be accepted
            </span>
            <Chevron open={pendingOpen} />
          </button>
          {pendingOpen && (
            <ul className="divide-y divide-edge/60 border-t border-edge/60">
              {pending.map((l) => (
                <li key={l.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-200">
                        {journalCoaches.find((j) => j.invite_id === l.id)
                          ?.display_name ?? "Invite link"}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-500">
                        {l.scope_match_id
                          ? `Only ${matchNames.get(l.scope_match_id) ?? "one match"}`
                          : l.all_matches
                            ? "All matches"
                            : "Only matches you share"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void copyInvite(l)}
                        className="rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
                      >
                        {copiedId === l.id ? "Copied" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void revokeLinks([l.id])}
                        disabled={busyIds.has(l.id)}
                        className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-60"
                      >
                        {busyIds.has(l.id) ? "Revoking…" : "Revoke"}
                      </button>
                    </span>
                  </div>
                  {/* Changing your mind before it is accepted (164). It
                      used to take a revoke and a fresh link, which is a
                      dead end on the one step of this flow you cannot
                      undo by yourself. A match-scoped invite has nothing
                      to choose. */}
                  {l.scope_match_id === null && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {(
                        [
                          [true, "All matches"],
                          [false, "Only matches I share"],
                        ] as const
                      ).map(([all, label]) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={l.all_matches === all}
                          disabled={busyIds.has(l.id)}
                          onClick={() => void setPendingScope(l, all)}
                          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                            l.all_matches === all
                              ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
                              : "border-edge text-zinc-300 hover:border-zinc-500 hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {links !== null && coaches.length === 0 && pending.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">No coaches yet.</p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
