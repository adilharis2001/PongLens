"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ShareWithCoach } from "@/components/ShareWithCoach";
import { createClient } from "@/lib/supabase/client";
import {
  coachAccessLine,
  invitesWaitingLabel,
  type CoachListState,
} from "@/lib/coaches/coachActions";
import { sortCoaches, type PlayerCoach } from "@/lib/coaches/playerCoaches";

/**
 * Every coach the player has, in one list.
 *
 * Built on `player_coaches_list()`, not on `player_coach_links()`, and that
 * is the whole reason this file exists rather than the section it replaces.
 * The old list was links: accepted grants plus pending invites. A coach the
 * player had only written down while filing a lesson has neither, so that
 * coach appeared NOWHERE on the page that is supposed to be the list of
 * coaches — not in the list, not in the pending block, not in "No coaches
 * yet." This page cannot be the home for written-down coaches while it is
 * built on links.
 *
 * One primary action: Add a coach, which mints an invite. That word means
 * one thing in the product now; the control that only writes a name down is
 * called New coach and lives in the lesson composer.
 */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A pending link nobody has put a name on yet. */
interface UnnamedInvite {
  id: string;
  invite_token: string;
}

export function CoachRoster({ userId }: { userId: string }) {
  const [coaches, setCoaches] = useState<PlayerCoach[]>([]);
  const [archived, setArchived] = useState<PlayerCoach[]>([]);
  const [unnamed, setUnnamed] = useState<UnnamedInvite[]>([]);
  const [state, setState] = useState<CoachListState>("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [live, gone, links] = await Promise.all([
      supabase.rpc("player_coaches_list"),
      supabase.rpc("player_coaches_archived_list"),
      supabase.rpc("player_coach_links"),
    ]);
    /* A dropped request is not an empty list. Saying "No coaches yet" to
       somebody with six of them, and hiding the invite door with it, is the
       bug this whole change exists to stop, arriving from a new direction. */
    if (live.error) {
      setState("failed");
      return;
    }
    const rows = (live.data as PlayerCoach[]) ?? [];
    setCoaches(rows);
    setArchived((gone.data as PlayerCoach[]) ?? []);
    const named = new Set(rows.map((c) => c.invite_id).filter(Boolean));
    setUnnamed(
      ((links.data as (UnnamedInvite & { status: string })[]) ?? [])
        .filter((l) => l.status === "pending" && !named.has(l.id))
        .map((l) => ({ id: l.id, invite_token: l.invite_token })),
    );
    setState("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = useCallback(
    async (id: string) => {
      setBusy(id);
      setError(null);
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc(
        "restore_player_coach",
        { p_id: id },
      );
      setBusy(null);
      if (err) {
        setError("Couldn't put them back. Try again.");
        return;
      }
      if (data === "merged") {
        setError("Their lessons moved onto the coach already on your list.");
      }
      await load();
    },
    [load],
  );

  const waiting = invitesWaitingLabel(
    coaches.filter((c) => c.status === "invited").length + unnamed.length,
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ShareWithCoach
          userId={userId}
          label="Add a coach"
          onLinkCreated={() => void load()}
          buttonClassName="glow-cta w-full rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink sm:w-auto"
        />
        {waiting && <p className="text-sm text-cyan-glow">{waiting}</p>}
      </div>

      {state === "failed" && (
        <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
          <p className="text-sm text-red-400">
            Couldn&rsquo;t load your coaches. Try again.
          </p>
          <button
            type="button"
            onClick={() => {
              setState("loading");
              void load();
            }}
            className="mt-3 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      {state === "loading" && (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl border border-edge bg-surface"
            />
          ))}
        </div>
      )}

      {state === "ready" && (
        <>
          {coaches.length === 0 && unnamed.length === 0 ? (
            <p className="mt-6 text-sm text-zinc-500">No coaches yet.</p>
          ) : (
            <div className="mt-6 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
              {sortCoaches(coaches).map((c) => (
                <Link
                  key={c.id}
                  href={`/coaching/coach/${c.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 text-xs font-semibold text-zinc-300">
                    {initials(c.display_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-200">
                      {c.display_name}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {coachAccessLine(c, null)}
                    </span>
                  </span>
                  <span className="shrink-0 text-zinc-600" aria-hidden>
                    ›
                  </span>
                </Link>
              ))}

              {/* Links nobody named. Before the roster these were invisible
                  on the phone entirely and unreachable here, so a link sent
                  and not saved was gone for good. Copy link stays on the row
                  for exactly that reason. */}
              {unnamed.map((l) => (
                <UnnamedInviteRow key={l.id} invite={l} onChanged={load} />
              ))}
            </div>
          )}

          {archived.length > 0 && (
            <div className="mt-8">
              <button
                type="button"
                onClick={() => setShowRemoved((v) => !v)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-edge bg-surface px-4 py-3 text-left"
              >
                <span className="text-sm font-medium text-zinc-300">
                  Removed coaches
                </span>
                <span className="text-xs text-zinc-500">
                  {archived.length}
                </span>
              </button>
              {showRemoved && (
                <div className="mt-2 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
                  {archived.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <span className="min-w-0 truncate text-sm text-zinc-400">
                        {c.display_name}
                      </span>
                      <button
                        type="button"
                        disabled={busy === c.id}
                        onClick={() => void restore(c.id)}
                        className="shrink-0 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-60"
                      >
                        {busy === c.id ? "Putting back…" : "Put back"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="mt-3 text-sm text-amber-300">{error}</p>}
    </div>
  );
}

/**
 * One pending link with nobody's name on it.
 *
 * Copy link is not optional here. Mint an invite without typing a name,
 * close the sheet before sending it, and this row is the only place the URL
 * still exists.
 */
function UnnamedInviteRow({
  invite,
  onChanged,
}: {
  invite: UnnamedInvite;
  onChanged: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const url =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/coach-invite/${invite.invite_token}`;

  return (
    <div className="px-4 py-3.5">
      <p className="text-sm font-medium text-zinc-500">Unnamed invite</p>
      <p className="mt-0.5 text-xs text-zinc-500">Invite waiting</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setCopyFailed(false);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopyFailed(true);
            }
          }}
          className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const supabase = createClient();
            await supabase
              .from("coach_links")
              .update({ status: "revoked" })
              .eq("id", invite.id);
            setBusy(false);
            await onChanged();
          }}
          className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-amber-300/90 transition-colors hover:border-amber-300/50 disabled:opacity-60"
        >
          {busy ? "Revoking…" : "Revoke"}
        </button>
      </div>
      {copyFailed && (
        <p className="mt-2 break-all text-xs text-zinc-500">
          Copy failed. Select the link and copy it manually: {url}
        </p>
      )}
    </div>
  );
}
