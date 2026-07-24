"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShareWithCoach } from "@/components/ShareWithCoach";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import type { CoachLinkRow } from "@/lib/types";

/**
 * Player-side sharing, modelled as PEOPLE, not links. Each accepted coach is
 * one row with a scope summary ("All matches" or "N matches") no matter how
 * many underlying coach_links back it — so sharing many matches with one
 * coach stays a single row. Expanding a coach reveals the per-match shares
 * (each revocable) and "Remove coach". Outstanding invites collapse into one
 * quiet "N waiting" line. Primary action is a compact "Add a coach".
 */

interface CoachGroup {
  key: string;
  name: string;
  email: string | null;
  links: CoachLinkRow[];
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

  const fetchLinks = useCallback(async () => {
    const supabase = createClient();
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
          name: l.coach_name ?? l.coach_email ?? "Coach",
          email: l.coach_email,
          links: [],
          watchesAll: false,
          matchIds: [],
        };
        map.set(key, g);
      }
      g.links.push(l);
      if (l.scope_match_id === null) g.watchesAll = true;
      else if (!g.matchIds.includes(l.scope_match_id))
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
      const { error: dbError } = await supabase
        .from("coach_links")
        .update({ status: "revoked" })
        .in("id", ids);
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
      : `${g.matchIds.length} match${g.matchIds.length === 1 ? "" : "es"}`;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Coaches</h2>
          <p className="mt-1 text-sm text-zinc-500">
            People who can watch your matches and leave notes.
          </p>
        </div>
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
                    {g.watchesAll ? (
                      <p className="mt-2 text-sm text-zinc-300">
                        Watches all your matches, including future uploads.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-2">
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
                                className="shrink-0 text-xs font-medium text-zinc-500 underline underline-offset-2 transition-colors hover:text-red-300 disabled:opacity-60"
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
                      className="mt-3 rounded-full border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:border-red-400 disabled:opacity-60"
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
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-200">
                      Invite link
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500">
                      {l.scope_match_id
                        ? `Only ${matchNames.get(l.scope_match_id) ?? "one match"}`
                        : "All matches"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyInvite(l)}
                      className="rounded-full border border-edge bg-surface-2 px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
                    >
                      {copiedId === l.id ? "Copied" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void revokeLinks([l.id])}
                      disabled={busyIds.has(l.id)}
                      className="rounded-full border border-red-500/40 bg-red-500/10 px-3.5 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:border-red-400 disabled:opacity-60"
                    >
                      {busyIds.has(l.id) ? "Revoking…" : "Revoke"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {links !== null && coaches.length === 0 && pending.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">
          Add a coach to let them watch your matches and leave notes.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
