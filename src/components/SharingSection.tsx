"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShareWithCoach } from "@/components/ShareWithCoach";
import type { CoachLinkRow } from "@/lib/types";

/**
 * Player-side sharing management: list of coach links (who, scope, status)
 * with revoke, plus the dashboard-level "Share with coach" entry point
 * (scope locked to all matches; per-match sharing lives on the match page).
 */
export function SharingSection({ userId }: { userId: string }) {
  const [links, setLinks] = useState<CoachLinkRow[] | null>(null);
  const [matchNames, setMatchNames] = useState<Map<string, string>>(new Map());
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        .select("id, opponent_name")
        .in("id", matchIds);
      setMatchNames(
        new Map(
          (matches ?? []).map((m) => [
            m.id as string,
            (m.opponent_name as string | null)?.trim() || "Match",
          ])
        )
      );
    }
  }, []);

  useEffect(() => {
    void fetchLinks();
  }, [fetchLinks]);

  const revoke = useCallback(
    async (link: CoachLinkRow) => {
      setRevoking(link.id);
      setError(null);
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from("coach_links")
        .update({ status: "revoked" })
        .eq("id", link.id);
      setRevoking(null);
      if (dbError) {
        setError("Couldn't revoke. Try again.");
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

  const active = (links ?? []).filter((l) => l.status !== "revoked");

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sharing</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Let a coach watch your matches and leave notes.
          </p>
        </div>
        <ShareWithCoach userId={userId} onLinkCreated={fetchLinks} />
      </div>

      {links !== null && active.length > 0 && (
        <ul className="mt-4 space-y-3">
          {active.map((link) => (
            <li
              key={link.id}
              className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-200">
                  {link.status === "accepted"
                    ? (link.coach_name ?? link.coach_email ?? "Coach")
                    : "Invite link"}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {link.status === "accepted" && link.coach_email
                    ? `${link.coach_email} · `
                    : ""}
                  {link.scope_match_id
                    ? `Only ${matchNames.get(link.scope_match_id) ?? "one match"}`
                    : "All matches"}
                  {link.status === "pending" ? " · waiting for accept" : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {link.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => void copyInvite(link)}
                    className="rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
                  >
                    {copiedId === link.id ? "Copied" : "Copy link"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void revoke(link)}
                  disabled={revoking === link.id}
                  className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:border-red-400 disabled:opacity-60"
                >
                  {revoking === link.id ? "Revoking…" : "Revoke"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
