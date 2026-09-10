"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShareWithCoach } from "@/components/ShareWithCoach";
import { ShareMatches } from "@/components/ShareMatches";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import type { CoachLinkRow } from "@/lib/types";
import {
  entryCountLabel,
  mergeCandidates,
  type PlayerCoach,
  coachStanding,
} from "@/lib/coaches/playerCoaches";
import { UNNAMED_INVITE, nameCoachInvite } from "@/lib/coaches/nameInvite";
import { CoachSharedWith } from "@/components/CoachSharedWith";
import {
  canEndAccess,
  canSendInvite,
  endAccessConfirm,
  removeConfirm,
  restoreNotice,
  type Confirm,
} from "@/lib/coaches/coachActions";

/**
 * Player-side sharing, modelled as PEOPLE, not links. Each accepted coach is
 * one row with a scope summary ("All matches" or "N matches") no matter how
 * many underlying coach_links back it — so sharing many matches with one
 * coach stays a single row. Expanding a coach reveals their access — all
 * matches, or only the ones shared from a match page — switchable either
 * way without removing them (161), the per-match shares (each revocable)
 * and "Remove coach". Outstanding invites collapse into one quiet "N
 * waiting" line. Primary action is a compact "Add a coach".
 *
 * `focusCoachId` turns the same component into ONE coach's page
 * (/coaching/coach/<player_coaches.id>): that coach only, always open, and
 * none of the list around them. Every rule below is the same one — the
 * access pair, the copy-and-revoke of a waiting invite, the per-match
 * revoke, the rename and the merge all run through the callbacks the list
 * uses, because a second statement of any of them is a second thing to get
 * wrong.
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


/** All matches, or only the ones you share. Written once because it is
 *  rendered three times — for an accepted coach, for a waiting invite and
 *  on a coach's own page — and three copies of a two-state control is how
 *  one of them ends up with a different pressed state. */
function AccessPair({
  all,
  disabled,
  className,
  onPick,
}: {
  all: boolean;
  disabled: boolean;
  className: string;
  onPick: (all: boolean) => void;
}) {
  return (
    <div className={className}>
      {(
        [
          [true, "All matches"],
          [false, "Only matches I share"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={label}
          type="button"
          aria-pressed={all === value}
          disabled={disabled}
          onClick={() => onPick(value)}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
            all === value
              ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
              : "border-edge text-zinc-300 hover:border-zinc-500 hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * A destructive action that says what it will do before it does it.
 *
 * Inline, the way CoachManageRows already expands, rather than a second
 * press of the same button changing meaning under the cursor. That is a new
 * interaction species for a destructive action and it would confirm
 * differently from the phone, which uses a real dialog.
 */
function ConfirmAction({
  label,
  confirm,
  busy,
  tone,
  onConfirm,
}: {
  /** What the resting button says. The confirmation asks the question. */
  label: string;
  confirm: Confirm;
  busy: boolean;
  tone: "soft" | "destructive";
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);

  const pill =
    tone === "destructive"
      ? "rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-amber-300/90 transition-colors hover:border-amber-300/60 disabled:opacity-60"
      : "rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-60";

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={busy}
        className={`mt-2 block w-full sm:w-auto ${pill}`}
      >
        {busy ? `${confirm.confirmLabel}\u2026` : label}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-edge bg-surface-2/40 p-4">
      <p className="text-sm font-medium text-zinc-200">{confirm.title}</p>
      <p className="mt-1 text-sm text-zinc-400">{confirm.body}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
          disabled={busy}
          className={pill}
        >
          {busy ? `${confirm.confirmLabel}\u2026` : confirm.confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Rename in your journal, and Same as an existing coach. The open row and
 *  the draft stay with the caller: only one coach is ever being edited, and
 *  opening one has always closed the other. */
function CoachManageRows({
  coach,
  candidates,
  renameFor,
  setRenameFor,
  renameDraft,
  setRenameDraft,
  mergeFor,
  setMergeFor,
  onRename,
  onMerge,
}: {
  coach: PlayerCoach;
  candidates: PlayerCoach[];
  renameFor: string | null;
  setRenameFor: (id: string | null) => void;
  renameDraft: string;
  setRenameDraft: (value: string) => void;
  mergeFor: string | null;
  setMergeFor: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onMerge: (into: string, from: string) => void;
}) {
  return (
    <>
      <div className="mt-2">
        <button
          type="button"
          onClick={() => {
            setMergeFor(null);
            setRenameDraft(coach.display_name);
            setRenameFor(renameFor === coach.id ? null : coach.id);
          }}
          className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
        >
          Rename in your journal
        </button>
        {renameFor === coach.id && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value.slice(0, 80))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onRename(coach.id, renameDraft);
                }
                if (e.key === "Escape") setRenameFor(null);
              }}
              maxLength={80}
              autoFocus
              aria-label="What you call this coach"
              className="min-w-0 flex-1 rounded-xl border border-edge bg-surface-2/40 px-3.5 py-2 text-sm text-zinc-100 focus:border-cyan-glow/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onRename(coach.id, renameDraft)}
              disabled={renameDraft.trim() === ""}
              className="shrink-0 rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 disabled:opacity-60"
            >
              Save
            </button>
          </div>
        )}
      </div>
      {candidates.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setMergeFor(mergeFor === coach.id ? null : coach.id)}
            className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            Same as an existing coach
          </button>
          {mergeFor === coach.id && (
            <ul className="mt-2 space-y-2">
              {candidates.map((other) => (
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
                    onClick={() => onMerge(coach.id, other.id)}
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
    </>
  );
}

export function SharingSection({
  userId,
  focusCoachId = null,
  children,
}: {
  userId: string;
  /** A `player_coaches.id`. Set it and the section stops being a list and
   *  becomes that one coach, always expanded, with no chrome around them:
   *  no "Coaches" heading, no chevron, no "Add a coach", nobody else. */
  focusCoachId?: string | null;
  /** Rendered inside the focused coach, between what they can see and
   *  Manage. Ignored by the list, which has no one coach to put it under.
   *  This is how /coaching/coach/<id> gets its lessons into the middle of
   *  a body this component owns the rest of. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [links, setLinks] = useState<CoachLinkRow[] | null>(null);
  const [matchNames, setMatchNames] = useState<Map<string, string>>(new Map());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingCoach, setRemovingCoach] = useState(false);
  const [expandedCoach, setExpandedCoach] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  // The journal side of the same people (164): how many entries are
  // attributed to each, and which named rows are still unclaimed.
  const [journalCoaches, setJournalCoaches] = useState<PlayerCoach[]>([]);
  // Whether that roster has answered once. The list never needed it — an
  // empty roster only quiets a line inside a coach that is already drawn —
  // but a page ABOUT one coach cannot tell "still loading" from "this
  // coach is gone" without it, and revoking an invite really does delete
  // the row (165).
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [mergeFor, setMergeFor] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  /** The waiting invite whose name is being typed, if any. */
  const [namingId, setNamingId] = useState<string | null>(null);
  const [inviteNameDraft, setInviteNameDraft] = useState("");

  /**
   * Take a coach off the list.
   *
   * One RPC, because the rules are the database's: it archives rather than
   * deletes (both foreign keys onto the row are `on delete set null`, and
   * that null blanks coach_name on every entry the coach ever taught), it
   * revokes an outstanding invite so an accept cannot resurrect them under
   * a different name, and it locks before it reads so an accept landing
   * mid-call cannot leave them with access and no row on screen.
   *
   * Afterwards we land on the roster, not the feed, because that is where
   * Put back is.
   */
  const removeCoach = useCallback(
    async (id: string) => {
      setRemovingCoach(true);
      setError(null);
      const supabase = createClient();
      const { error: err } = await supabase.rpc("remove_player_coach", {
        p_id: id,
      });
      setRemovingCoach(false);
      if (err) {
        setError("Couldn't remove them. Try again.");
        return;
      }
      router.replace("/coaching/coach");
      router.refresh();
    },
    [router],
  );

  const fetchLinks = useCallback(async () => {
    const supabase = createClient();
    void supabase.rpc("player_coaches_list").then(({ data: rows }) => {
      setJournalCoaches((rows as PlayerCoach[]) ?? []);
      setRosterLoaded(true);
    });
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

  /** What YOU call this coach, which is not always what their account
   *  says (164). Adil's own case: the account reads "Jonatan Mcdonald"
   *  and he has always written "Jonathan". The name is what every journal
   *  entry shows, and a trigger carries a rename to all of them, so this
   *  is the one place it can be put right. The coach's own account is
   *  untouched — this is a label, not their identity. */
  const renameCoach = useCallback(
    async (id: string, name: string) => {
      const clean = name.trim().replace(/\s+/gu, " ").slice(0, 80);
      if (!clean) return;
      setError(null);
      setRenameFor(null);
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from("player_coaches")
        // name_from_account false: you typed it, so it stops following
        // the account. Same rule as the coach's roster (161).
        .update({ display_name: clean, name_from_account: false })
        .eq("id", id);
      if (dbError) setError("Couldn't rename them. Try again.");
      await fetchLinks();
      // On the coach's own page the name is also the page title, and that
      // is rendered on the server. Without this the heading keeps the old
      // name until the next navigation, one line above the field that has
      // just changed it.
      if (focusCoachId) router.refresh();
    },
    [fetchLinks, focusCoachId, router],
  );

  /** Name a waiting invite that was created without one (164). The field
   *  is optional at creation and easy to skip, and the name is what puts
   *  that coach in the journal's picker — so it has to be addable
   *  afterwards rather than needing a revoke and a fresh link. */
  const nameInvite = useCallback(
    async (inviteId: string, name: string) => {
      setError(null);
      setBusyIds((prev) => new Set(prev).add(inviteId));
      const ok = await nameCoachInvite(createClient(), userId, inviteId, name);
      if (!ok) setError("Couldn't save that name. Try again.");
      await fetchLinks();
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(inviteId);
        return next;
      });
      setNamingId(null);
    },
    [userId, fetchLinks],
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

  /* One coach's page. Everything below reads from the same state the list
     does; nothing here talks to the database on its own. */
  if (focusCoachId) {
    if (links === null || !rosterLoaded) {
      return (
        <div className="h-28 animate-pulse rounded-2xl border border-edge bg-surface" />
      );
    }

    const j = journalCoaches.find((c) => c.id === focusCoachId) ?? null;
    if (!j) {
      // Revoking a waiting invite DELETES the roster row when no lesson is
      // attributed to it (165), so this page can lose its subject while
      // somebody is standing on it. Saying so beats a page of nothing.
      return (
        <section>
          <p className="text-sm text-zinc-400">
            This coach is no longer on your list.
          </p>
          <Link
            href="/coaching"
            className="mt-4 inline-block rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            Back to Coaching
          </Link>
        </section>
      );
    }

    // A coach only has access to control if there is a link behind them. A
    // name the player typed has neither an account nor an invite, so the
    // page is their standing, their lessons and the Manage rows — not an
    // access pair wired to nothing. That is the common case for a coach who
    // is not on PongLens, not an edge one.
    const group =
      j.status === "connected"
        ? (coaches.find((x) => x.coachId === j.coach_id) ?? null)
        : null;
    const invite =
      j.status === "invited" && j.invite_id
        ? (pending.find((l) => l.id === j.invite_id) ?? null)
        : null;
    const watchesAll = group
      ? group.watchesAll
      : invite
        ? invite.scope_match_id === null && invite.all_matches
        : false;
    const groupIds = group?.links.map((l) => l.id) ?? [];
    const removing = groupIds.length > 0 && groupIds.every((id) => busyIds.has(id));

    return (
      <section>
        <p className="text-sm text-zinc-300">
          {coachStanding(j)}
          {j.coach_email && (
            <span className="text-zinc-500"> · {j.coach_email}</span>
          )}
        </p>

        {/* Removing a coach revokes any invite that was out, and putting
            them back does not revive it: the list needs a PENDING link to
            read "Invite waiting". Without this line they simply come back
            reading "Not on PongLens" and the link is gone with no account
            of where. */}
        {restoreNotice(j.status) && j.status === "offline" && j.invite_id && (
          <p className="mt-2 text-sm text-zinc-500">
            {restoreNotice(j.status)}
          </p>
        )}

        {/* The action this whole page was missing. A coach the player wrote
            down, or one they have parted with, had no way to be invited:
            the composer always started from a blank name, so the only way
            was to type their name again and hope the find-or-create matched
            it. This binds the new invite onto THIS row by id. */}
        {canSendInvite(j) && (
          <div className="mt-3">
            <ShareWithCoach
              userId={userId}
              coachRefId={j.id}
              label="Send an invite"
              title="Send an invite"
              onLinkCreated={() => void fetchLinks()}
              buttonClassName="glow-cta w-full rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink sm:w-auto"
            />
          </div>
        )}

        {invite && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyInvite(invite)}
              className="rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
            >
              {copiedId === invite.id ? "Copied" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => void revokeLinks([invite.id])}
              disabled={busyIds.has(invite.id)}
              className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-60"
            >
              {busyIds.has(invite.id) ? "Revoking…" : "Revoke"}
            </button>
          </div>
        )}

        {group && (
          <>
            <AccessPair
              className="mt-4 flex flex-wrap gap-2"
              all={group.watchesAll}
              disabled={busyIds.has(group.key)}
              onPick={(all) => void setAccess(group, all)}
            />
            {/* It used to end "…from a match page", which was the only
                way to share one. Share a match now sits on the coach's own
                page too, so naming one of the two doors made the sentence
                wrong on the page that has the other. */}
            <p className="mt-2 text-sm text-zinc-300">
              {group.watchesAll
                ? "Watches all your matches, including future uploads."
                : "Sees only the matches you share with them."}
            </p>
          </>
        )}

        {invite && invite.scope_match_id === null && (
          <AccessPair
            className="mt-4 flex flex-wrap gap-2"
            all={invite.all_matches}
            disabled={busyIds.has(invite.id)}
            onPick={(all) => void setPendingScope(invite, all)}
          />
        )}

        {/* What they hold, each line removable. Only for a coach who can
            actually read something: offering to share an entry with a name
            in a notebook would be a control over nothing. */}
        {(group || invite) && (
          <CoachSharedWith
            coachRefId={j.id}
            inviteId={invite?.id ?? null}
            allMatches={watchesAll}
            matchLinks={
              group
                ? group.links
                    .filter((l) => l.scope_match_id)
                    .map((l) => ({
                      linkId: l.id,
                      matchId: l.scope_match_id as string,
                    }))
                : invite?.scope_match_id
                  ? [{ linkId: null, matchId: invite.scope_match_id }]
                  : []
            }
            onChanged={fetchLinks}
          />
        )}

        {(group || invite) && !watchesAll && (
          <ShareMatches
            userId={userId}
            coachId={group?.coachId ?? null}
            inviteId={invite?.id ?? null}
            onShared={fetchLinks}
          />
        )}

        {children}

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Manage
          </p>
          <CoachManageRows
            coach={j}
            candidates={mergeCandidates(journalCoaches, j)}
            renameFor={renameFor}
            setRenameFor={setRenameFor}
            renameDraft={renameDraft}
            setRenameDraft={setRenameDraft}
            mergeFor={mergeFor}
            setMergeFor={setMergeFor}
            onRename={(id, name) => void renameCoach(id, name)}
            onMerge={(into, from) => void mergeCoach(into, from)}
          />
          {/* Ending access is not removal, and the two cannot both be
              called Remove. This one stops them watching and keeps them on
              the list; the one below takes them off it. Only a connected
              coach has access to end. */}
          {canEndAccess(j) && (
            <ConfirmAction
              label="End their access"
              confirm={endAccessConfirm(j)}
              busy={removing}
              tone="soft"
              onConfirm={() => void revokeLinks(groupIds)}
            />
          )}

          {/* Every standing, with no gate. Until 2026-09-10 this button was
              wired to leave_coach and therefore hidden for a coach the
              player had only written down, so that row was permanent. */}
          <ConfirmAction
            label="Remove from your list"
            confirm={removeConfirm(j)}
            busy={removingCoach}
            tone="destructive"
            onConfirm={() => void removeCoach(j.id)}
          />
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </section>
    );
  }

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
                            {j.display_name !== g.name
                              ? `, under "${j.display_name}"`
                              : ""}
                            .
                          </p>
                          <CoachManageRows
                            coach={j}
                            candidates={spare}
                            renameFor={renameFor}
                            setRenameFor={setRenameFor}
                            renameDraft={renameDraft}
                            setRenameDraft={setRenameDraft}
                            mergeFor={mergeFor}
                            setMergeFor={setMergeFor}
                            onRename={(id, name) => void renameCoach(id, name)}
                            onMerge={(into, from) => void mergeCoach(into, from)}
                          />
                        </div>
                      );
                    })()}
                    <AccessPair
                      className="mt-3 flex flex-wrap gap-2"
                      all={g.watchesAll}
                      disabled={busyIds.has(g.key)}
                      onPick={(all) => void setAccess(g, all)}
                    />
                    <p className="mt-2 text-sm text-zinc-300">
                      {g.watchesAll
                        ? "Watches all your matches, including future uploads."
                        : "Sees only the matches you share with them."}
                    </p>
                    {/* Matches AND journal entries, each removable. The
                        matches were listed here already; the journal was
                        a count, and a count is not something you can take
                        back one line of. */}
                    <CoachSharedWith
                      coachRefId={
                        journalCoaches.find(
                          (x) => x.coach_id && x.coach_id === g.coachId,
                        )?.id ?? null
                      }
                      inviteId={null}
                      allMatches={g.watchesAll}
                      matchLinks={g.links
                        .filter((l) => l.scope_match_id)
                        .map((l) => ({
                          linkId: l.id,
                          matchId: l.scope_match_id as string,
                        }))}
                      onChanged={fetchLinks}
                    />
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
                      {(() => {
                        const named = journalCoaches.find(
                          (j) => j.invite_id === l.id,
                        )?.display_name;
                        return (
                          <span
                            className={`block truncate text-sm font-medium ${
                              named ? "text-zinc-200" : "text-zinc-500"
                            }`}
                          >
                            {named ?? UNNAMED_INVITE}
                          </span>
                        );
                      })()}
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
                  {/* Naming it afterwards. "Invite link" used to sit
                      exactly where a coach's name goes, so an unnamed
                      invite read as a coach called Invite Link — and
                      there was no way to put a name on it short of
                      revoking and sending a new one. */}
                  {!journalCoaches.some((j) => j.invite_id === l.id) &&
                    (namingId === l.id ? (
                      <div className="mt-2.5 flex gap-2">
                        <input
                          type="text"
                          value={inviteNameDraft}
                          onChange={(e) =>
                            setInviteNameDraft(e.target.value.slice(0, 80))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void nameInvite(l.id, inviteNameDraft);
                            }
                            if (e.key === "Escape") setNamingId(null);
                          }}
                          maxLength={80}
                          autoFocus
                          placeholder="Their name"
                          aria-label="Coach name"
                          className="min-w-0 flex-1 rounded-xl border border-edge bg-surface-2/40 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/60 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void nameInvite(l.id, inviteNameDraft)}
                          disabled={
                            busyIds.has(l.id) || inviteNameDraft.trim() === ""
                          }
                          className="shrink-0 rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-sm font-semibold text-zinc-200 disabled:opacity-60"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setInviteNameDraft("");
                          setNamingId(l.id);
                        }}
                        className="mt-2.5 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                      >
                        Add a name
                      </button>
                    ))}

                  {/* What is already lined up for them (166/169). It was
                      invisible from the moment the invite was sent. */}
                  <CoachSharedWith
                    coachRefId={
                      journalCoaches.find((j) => j.invite_id === l.id)?.id ??
                      null
                    }
                    inviteId={l.id}
                    allMatches={l.scope_match_id === null && l.all_matches}
                    matchLinks={
                      l.scope_match_id
                        ? [{ linkId: null, matchId: l.scope_match_id }]
                        : []
                    }
                    onChanged={fetchLinks}
                  />

                  {l.scope_match_id === null && (
                    <AccessPair
                      className="mt-2.5 flex flex-wrap gap-2"
                      all={l.all_matches}
                      disabled={busyIds.has(l.id)}
                      onPick={(all) => void setPendingScope(l, all)}
                    />
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
