"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deriveMatchTitleParts } from "@/lib/matchTitle";

/**
 * Account — active public share links (anyone-with-the-link). Collapsed by
 * default to a summary ("N active links · across M matches"): Account's job
 * here is the safety switch, not day-to-day management (that lives in each
 * match's Share sheet). "Manage" expands the full list grouped by match;
 * "Revoke all" is the kill switch.
 */

interface ShareLinkRow {
  id: string;
  kind: "point" | "match" | "starred";
  match_id: string;
  point_id: string | null;
  token: string;
  title: string | null;
  created_at: string;
}

function kindLabel(kind: ShareLinkRow["kind"]) {
  return kind === "point"
    ? "Point"
    : kind === "starred"
      ? "Starred points"
      : "Match";
}

export function ShareLinksSection() {
  const [links, setLinks] = useState<ShareLinkRow[] | null>(null);
  const [matchNames, setMatchNames] = useState<Map<string, string>>(new Map());
  const [revoking, setRevoking] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("share_links")
      .select("id, kind, match_id, point_id, token, title, created_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as ShareLinkRow[];
    setLinks(rows);
    const matchIds = [...new Set(rows.map((l) => l.match_id))];
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
    void load();
  }, [load]);

  const revoke = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setError(null);
      setRevoking((prev) => new Set([...prev, ...ids]));
      try {
        await Promise.all(
          ids.map((id) =>
            fetch("/api/share/revoke", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id }),
            }).then((res) => {
              if (!res.ok) throw new Error("revoke failed");
            })
          )
        );
        await load();
      } catch {
        setError("Couldn't revoke. Try again.");
      } finally {
        setRevoking((prev) => {
          const n = new Set(prev);
          ids.forEach((i) => n.delete(i));
          return n;
        });
        setConfirmAll(false);
      }
    },
    [load]
  );

  const copy = useCallback(async (link: ShareLinkRow) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/s/${link.token}`
      );
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard blocked; nothing else to do
    }
  }, []);

  // Group by match so the expanded list reads by opponent, not a flat wall.
  const groups = useMemo(() => {
    const map = new Map<string, ShareLinkRow[]>();
    for (const l of links ?? []) {
      const arr = map.get(l.match_id) ?? [];
      arr.push(l);
      map.set(l.match_id, arr);
    }
    return [...map.entries()];
  }, [links]);

  const count = links?.length ?? 0;
  const matchCount = groups.length;

  return (
    <section>
      <h2 className="text-lg font-semibold">Public links</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Anyone with a link can watch until you revoke it.
      </p>

      {links !== null && count === 0 && (
        <p className="mt-4 text-sm text-zinc-500">
          Links you share appear here.
        </p>
      )}

      {count > 0 && (
        <>
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-edge bg-surface px-4 py-3">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0 text-zinc-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 15l6-6m-4-1 1-1a3.5 3.5 0 1 1 5 5l-1 1m-6 6-1 1a3.5 3.5 0 1 1-5-5l1-1"
              />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-200">
                {count} active link{count === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Across {matchCount} match{matchCount === 1 ? "" : "es"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="shrink-0 rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
            >
              {open ? "Hide" : "Manage"}
            </button>
          </div>

          {open && (
            <>
              <div className="mt-3 space-y-4">
                {groups.map(([matchId, rows]) => (
                  <div key={matchId}>
                    <p className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {matchNames.get(matchId) ?? "Match"}
                    </p>
                    <ul className="mt-2 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
                      {rows.map((link) => (
                        <li
                          key={link.id}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <span className="min-w-0 truncate text-sm text-zinc-300">
                            {link.title?.trim() || kindLabel(link.kind)}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void copy(link)}
                              className="rounded-full border border-edge bg-surface-2 px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
                            >
                              {copiedId === link.id ? "Copied" : "Copy"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void revoke([link.id])}
                              disabled={revoking.has(link.id)}
                              className="rounded-full border border-red-500/40 bg-red-500/10 px-3.5 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:border-red-400 disabled:opacity-60"
                            >
                              {revoking.has(link.id) ? "Revoking…" : "Revoke"}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex justify-end">
                {confirmAll ? (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">
                      Revoke all {count}?
                    </span>
                    <button
                      type="button"
                      onClick={() => void revoke((links ?? []).map((l) => l.id))}
                      className="rounded-full border border-red-500/50 bg-red-500/15 px-4 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:border-red-400"
                    >
                      Revoke all
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAll(false)}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmAll(true)}
                    className="text-xs font-medium text-zinc-500 underline underline-offset-2 transition-colors hover:text-red-300"
                  >
                    Revoke all
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
