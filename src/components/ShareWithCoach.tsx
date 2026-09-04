"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShareQR } from "@/components/ShareQR";
import { UNNAMED_INVITE, nameCoachInvite } from "@/lib/coaches/nameInvite";
import {
  InviteStarterPack,
  useStarterPack,
} from "@/components/InviteStarterPack";

/** One waiting invite, from pending_invite_matches() (166): who it is
 *  for, what it already covers, and whether THIS match is lined up to go
 *  over the moment they accept. */
interface PendingInvite {
  invite_id: string;
  invite_token: string;
  display_name: string | null;
  all_matches: boolean;
  scope_match_id: string | null;
  queued: boolean;
}

interface ConnectedCoach {
  id: string;
  name: string;
  allMatches: boolean;
  matchLinkId: string | null;
  otherMatches: number;
}

/**
 * Share with coach. Your connected coaches come first, by name, with what
 * they can see and a one-tap share for this match (160) — the invite link
 * below is only for a coach you have not connected yet. A player-written,
 * match-scoped accepted link is the direct grant; the coach hears about it
 * the same way they hear about a student's match turning ready.
 *
 * The invite half creates a pending coach_links row (scoped to one match
 * or all matches) and hands back an invite URL to copy or share.
 *
 * Two exports:
 *   ShareWithCoachSheet — the controlled sheet body. The ShareSheet's
 *     "With your coach" row opens this; the dashboard button does too.
 *   ShareWithCoach — legacy button + sheet wrapper (dashboard, where there
 *     is no match in context so scope is locked to "all").
 */

export function ShareWithCoachSheet({
  open,
  onClose,
  userId,
  matchId,
  onLinkCreated,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  matchId?: string;
  onLinkCreated?: () => void;
}) {
  // "selected" is the Coaching-tab case (161): connect the coach now,
  // share matches one at a time from their pages.
  const [scope, setScope] = useState<"match" | "all" | "selected">(
    matchId ? "match" : "all",
  );
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [coaches, setCoaches] = useState<ConnectedCoach[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [busyCoach, setBusyCoach] = useState<string | null>(null);
  // Who the invite is for (164). Optional, and it does two things: the
  // waiting invite says a name instead of "Invite link", and the journal
  // can attribute entries to them straight away, before they accept.
  // That second one is the whole reason an invited coach needed a row.
  const [inviteName, setInviteName] = useState("");
  /** The waiting invite whose name is being typed, if any. */
  const [namingId, setNamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  /** What the new coach finds waiting when they accept (166/169). */
  const [pickedMatches, setPickedMatches] = useState<Set<string>>(new Set());
  const [pickedEntries, setPickedEntries] = useState<Set<string>>(new Set());

  const starter = useStarterPack(userId, open && !link);

  const loadCoaches = useCallback(async () => {
    if (!matchId) {
      setCoaches([]);
      setInvites([]);
      return;
    }
    const supabase = createClient();
    void supabase
      .rpc("pending_invite_matches", { p_match_id: matchId })
      .then(({ data }) => setInvites((data as PendingInvite[]) ?? []));
    const [linksRes, namesRes] = await Promise.all([
      supabase
        .from("coach_links")
        .select("id, coach_id, scope_match_id, all_matches, status")
        .eq("player_id", userId)
        .eq("status", "accepted"),
      supabase.rpc("player_coach_links"),
    ]);
    const names = new Map<string, string>();
    for (const n of (namesRes.data as {
      id: string;
      coach_name: string | null;
      coach_email: string | null;
    }[]) ?? []) {
      names.set(n.id, n.coach_name ?? n.coach_email ?? "Coach");
    }
    const byCoach = new Map<
      string,
      { id: string; scope_match_id: string | null; all_matches: boolean }[]
    >();
    for (const l of (linksRes.data as {
      id: string;
      coach_id: string | null;
      scope_match_id: string | null;
      all_matches: boolean;
    }[]) ?? []) {
      if (!l.coach_id) continue;
      byCoach.set(l.coach_id, [...(byCoach.get(l.coach_id) ?? []), l]);
    }
    const rows: ConnectedCoach[] = [...byCoach.entries()].map(
      ([coachId, links]) => ({
        id: coachId,
        name: links.map((l) => names.get(l.id)).find(Boolean) ?? "Coach",
        allMatches: links.some(
          (l) => l.scope_match_id === null && l.all_matches,
        ),
        matchLinkId:
          links.find((l) => l.scope_match_id === matchId)?.id ?? null,
        otherMatches: links.filter(
          (l) => l.scope_match_id !== null && l.scope_match_id !== matchId,
        ).length,
      }),
    );
    rows.sort((a, b) => a.name.localeCompare(b.name));
    setCoaches(rows);
  }, [userId, matchId]);

  useEffect(() => {
    if (!open) return;
    setScope(matchId ? "match" : "all");
    setLink(null);
    setError(null);
    setCopied(false);
    setInviteName("");
    setPickedMatches(new Set());
    setPickedEntries(new Set());
    void loadCoaches();
  }, [open, matchId, loadCoaches]);

  const shareWith = async (coach: ConnectedCoach) => {
    if (!matchId) return;
    setBusyCoach(coach.id);
    const supabase = createClient();
    const { error: dbError } = await supabase.from("coach_links").insert({
      player_id: userId,
      coach_id: coach.id,
      scope_match_id: matchId,
      status: "accepted",
    });
    if (dbError) setError("Couldn't share it. Try again.");
    await loadCoaches();
    setBusyCoach(null);
    onLinkCreated?.();
  };

  const unshareWith = async (coach: ConnectedCoach) => {
    if (!coach.matchLinkId) return;
    setBusyCoach(coach.id);
    const supabase = createClient();
    await supabase.from("coach_links").delete().eq("id", coach.matchLinkId);
    await loadCoaches();
    setBusyCoach(null);
    onLinkCreated?.();
  };

  /** Line this match up for a coach who has not accepted yet (166).
   *
   *  Nothing is shared here: the row says what the ACCEPT should hand
   *  over, and access is still only ever an accepted coach_links row. It
   *  is the difference between "share it now" and "they get this one when
   *  they arrive", and the copy has to keep saying which. */
  const queueForInvite = useCallback(
    async (invite: PendingInvite, on: boolean) => {
      if (!matchId) return;
      setBusyCoach(invite.invite_id);
      setError(null);
      const supabase = createClient();
      const { error: dbError } = on
        ? await supabase
            .from("coach_invite_matches")
            .insert({ invite_id: invite.invite_id, match_id: matchId })
        : await supabase
            .from("coach_invite_matches")
            .delete()
            .eq("invite_id", invite.invite_id)
            .eq("match_id", matchId);
      if (dbError) setError("Couldn't change it. Try again.");
      await loadCoaches();
      setBusyCoach(null);
      onLinkCreated?.();
    },
    [matchId, loadCoaches, onLinkCreated],
  );

  /** Name a waiting invite that was created without one (164).
   *
   *  The field is optional at creation and easy to skip — Adil skipped it
   *  and then asked why the row said "Invite link" (2026-09-04). It is
   *  not decoration: the name is what puts that coach in the journal's
   *  picker, so it has to be addable afterwards rather than needing the
   *  invite revoked and sent again. */
  const nameInvite = useCallback(
    async (inviteId: string, name: string) => {
      setBusyCoach(inviteId);
      setError(null);
      const ok = await nameCoachInvite(createClient(), userId, inviteId, name);
      if (!ok) setError("Couldn't save that name. Try again.");
      await loadCoaches();
      setBusyCoach(null);
      setNamingId(null);
      onLinkCreated?.();
    },
    [userId, loadCoaches, onLinkCreated],
  );

  const coachState = (c: ConnectedCoach) =>
    c.allMatches
      ? "Sees all your matches"
      : c.matchLinkId
        ? "Has this match"
        : c.otherMatches > 0
          ? `Has ${c.otherMatches} other match${c.otherMatches === 1 ? "" : "es"}`
          : "Doesn't have this match";

  const createLink = useCallback(async () => {
    setCreating(true);
    setError(null);
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("coach_links")
      .insert({
        player_id: userId,
        scope_match_id: scope === "match" && matchId ? matchId : null,
        all_matches: scope === "all",
      })
      .select("id, invite_token")
      .single();
    if (dbError || !data?.invite_token) {
      setCreating(false);
      setError("Couldn't create the link. Try again.");
      return;
    }
    // The name, if one was given. A failure here loses the name and not
    // the invite: the link is the thing being asked for, and it can be
    // named afterwards from the waiting-invite row.
    await nameCoachInvite(supabase, userId, data.id, inviteName);

    // The head start. Matches are QUEUED against the invite and only
    // become access when somebody accepts it (166). Entries need the
    // coach's row, which naming just made — without a name there is
    // nothing to attribute them to, so they are skipped rather than
    // written somewhere they cannot be read.
    const matchIds = [...pickedMatches];
    if (scope !== "all" && matchIds.length > 0) {
      await supabase
        .from("coach_invite_matches")
        .insert(matchIds.map((id) => ({ invite_id: data.id, match_id: id })));
    }
    const entryIds = [...pickedEntries];
    if (entryIds.length > 0) {
      const { data: mine } = await supabase
        .from("player_coaches")
        .select("id")
        .eq("player_id", userId)
        .eq("invite_id", data.id)
        .maybeSingle();
      const coachRefId = (mine as { id: string } | null)?.id;
      if (coachRefId) {
        await supabase
          .from("lessons")
          .update({
            coach_ref_id: coachRefId,
            shared_with_coach_at: new Date().toISOString(),
          })
          .in("id", entryIds);
      }
    }
    setCreating(false);
    setLink(`${window.location.origin}/coach-invite/${data.invite_token}`);
    onLinkCreated?.();
  }, [
    userId,
    matchId,
    scope,
    inviteName,
    pickedMatches,
    pickedEntries,
    onLinkCreated,
  ]);

  const copy = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Select the link and copy it manually.");
    }
  }, [link]);

  const nativeShare = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.share({
        title: "PongLens match invite",
        text: "Watch my table tennis matches on PongLens",
        url: link,
      });
    } catch {
      // user dismissed the share sheet; nothing to do
    }
  }, [link]);

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  /** Is there a left-hand column worth splitting the sheet for? People
   *  who already hold this match, or are queued to. With nobody there,
   *  a lone invite form stretched across a wide card reads worse than a
   *  narrow one, so the sheet stays one column. */
  const twoUp =
    !link &&
    Boolean(matchId) &&
    ((coaches?.length ?? 0) > 0 || invites.length > 0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close share sheet"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      {/* A bottom sheet on a phone, a centred card from sm up, and from
          lg a TWO-COLUMN card — because on a desktop the one-column
          version is a tall thin ribbon you scroll for a while, which is
          a mobile layout wearing a desktop's clothes (Adil, 2026-09-04,
          twice). Who already has this match on the left, the new invite
          on the right, so the whole sheet fits a laptop window without
          scrolling. Two columns only when the left one has something in
          it; a lone invite form spread across 900px is worse than a
          narrow one. In every case it must be shorter than the window:
          it had no height cap at all until the head start ran off the
          bottom of the screen. */}
      <div
        className={`absolute inset-x-0 bottom-0 max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-t-2xl border border-edge bg-surface p-5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-3rem)] sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6 ${
          twoUp ? "sm:max-w-lg lg:max-w-4xl" : "sm:max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Share with coach</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div
          className={
            twoUp ? "lg:grid lg:grid-cols-2 lg:items-start lg:gap-7" : undefined
          }
        >
          <div>
            {matchId && coaches && coaches.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Your coaches
                </p>
                <div className="mt-2 divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-surface-2/60">
                  {coaches.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-zinc-100">
                          {c.name}
                        </span>
                        <span className="block text-xs text-zinc-500">
                          {coachState(c)}
                        </span>
                      </span>
                      {c.allMatches ? (
                        <span className="text-sm font-medium text-cyan-glow">
                          All matches
                        </span>
                      ) : busyCoach === c.id ? (
                        <span className="text-sm text-zinc-500">…</span>
                      ) : c.matchLinkId ? (
                        <button
                          type="button"
                          onClick={() => void unshareWith(c)}
                          className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void shareWith(c)}
                          className="glow-cta rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink"
                        >
                          Share
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Sharing hands them this match. Take it back any time from
                  Coaching.
                </p>
              </div>
            )}

            {/* Coaches you have invited but who have not opened the link yet
            (166). You could not reach them at all before: sharing writes
            an accepted link, and there is no account to write one for. So
            this lines the match up instead, and the accept hands it over.
            Adil asked for it by name on 2026-09-04. */}
            {matchId && invites.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Waiting to accept
                </p>
                <div className="mt-2 divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-surface-2/60">
                  {invites.map((inv) => {
                    const covered =
                      inv.all_matches || inv.scope_match_id === matchId;
                    return (
                      <div
                        key={inv.invite_id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-sm font-medium ${
                              inv.display_name
                                ? "text-zinc-100"
                                : "text-zinc-500"
                            }`}
                          >
                            {inv.display_name ?? UNNAMED_INVITE}
                          </span>
                          <span className="block text-xs text-zinc-500">
                            {covered
                              ? inv.all_matches
                                ? "Gets all your matches when they accept"
                                : "Their invite is for this match"
                              : inv.queued
                                ? "Gets this match when they accept"
                                : "Hasn't opened the link yet"}
                          </span>
                          {!inv.display_name &&
                            (namingId === inv.invite_id ? (
                              <span className="mt-2 flex gap-2">
                                <input
                                  type="text"
                                  value={nameDraft}
                                  onChange={(e) =>
                                    setNameDraft(e.target.value.slice(0, 80))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      void nameInvite(inv.invite_id, nameDraft);
                                    }
                                    if (e.key === "Escape") setNamingId(null);
                                  }}
                                  maxLength={80}
                                  autoFocus
                                  placeholder="Their name"
                                  aria-label="Coach name"
                                  className="min-w-0 flex-1 rounded-lg border border-edge bg-ink/40 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/60 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    void nameInvite(inv.invite_id, nameDraft)
                                  }
                                  disabled={nameDraft.trim() === ""}
                                  className="shrink-0 rounded-full border border-edge bg-surface-2 px-3 py-1 text-sm font-semibold text-zinc-200 disabled:opacity-60"
                                >
                                  Save
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setNameDraft("");
                                  setNamingId(inv.invite_id);
                                }}
                                className="mt-1 text-sm font-medium text-cyan-glow"
                              >
                                Add a name
                              </button>
                            ))}
                        </span>
                        {covered ? null : busyCoach === inv.invite_id ? (
                          <span className="text-sm text-zinc-500">…</span>
                        ) : inv.queued ? (
                          <button
                            type="button"
                            onClick={() => void queueForInvite(inv, false)}
                            className="shrink-0 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void queueForInvite(inv, true)}
                            className="glow-cta shrink-0 rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink"
                          >
                            Share
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div>
            {/* The header has to describe what is under it. It said "Invite
            another coach" over a link that had just been made, which
            reads as a second invitation nobody asked for (Adil,
            2026-09-04). */}
            {(link ||
              (matchId &&
                ((coaches?.length ?? 0) > 0 || invites.length > 0))) && (
              <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-zinc-500 lg:mt-4">
                {link ? "Send this invite" : "Invite another coach"}
              </p>
            )}

            {/* Everything the section header promises, inside one drawn box.
            The name, the scope and the head start used to sit loose on
            the sheet under that header, each with an eyebrow of its own,
            so "Give them a head start" and "Create invite link" read as
            new sections rather than steps of this one (Adil,
            2026-09-04). A border is what makes a heading own what
            follows it. */}
            <div className="mt-2 rounded-2xl border border-edge bg-surface-2/30 p-4">
              {!link ? (
                <>
                  <p className="text-sm text-zinc-400">
                    Your coach can watch, but not edit. They can add notes.
                  </p>
                  {/* Naming them now is what lets the journal attribute lessons
                to this coach before they have accepted anything. */}
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value.slice(0, 80))}
                    maxLength={80}
                    placeholder="Their name (optional)"
                    aria-label="Coach name"
                    autoComplete="off"
                    className="mt-3 w-full rounded-xl border border-edge bg-ink/40 px-3.5 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
                  />
                  {/* Always exactly two choices, so they sit side by side and
                cost one row instead of two. */}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {matchId && (
                      <button
                        type="button"
                        aria-pressed={scope === "match"}
                        onClick={() => setScope("match")}
                        className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                          scope === "match"
                            ? "border-cyan-glow/60 bg-cyan-glow/10"
                            : "border-edge bg-ink/40 hover:border-cyan-glow/40"
                        }`}
                      >
                        <p className="text-sm font-semibold text-zinc-100">
                          This match
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Your coach sees only this match.
                        </p>
                      </button>
                    )}
                    <button
                      type="button"
                      aria-pressed={scope === "all"}
                      onClick={() => setScope("all")}
                      className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                        scope === "all"
                          ? "border-cyan-glow/60 bg-cyan-glow/10"
                          : "border-edge bg-ink/40 hover:border-cyan-glow/40"
                      }`}
                    >
                      <p className="text-sm font-semibold text-zinc-100">
                        All my matches
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Every match, including future uploads.
                      </p>
                    </button>
                    {!matchId && (
                      <button
                        type="button"
                        aria-pressed={scope === "selected"}
                        onClick={() => setScope("selected")}
                        className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                          scope === "selected"
                            ? "border-cyan-glow/60 bg-cyan-glow/10"
                            : "border-edge bg-ink/40 hover:border-cyan-glow/40"
                        }`}
                      >
                        <p className="text-sm font-semibold text-zinc-100">
                          Only matches I share
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          You share each match from its page. Change this any
                          time.
                        </p>
                      </button>
                    )}
                  </div>
                  {/* Only when a name has been typed for the entries half:
                an entry has to be attributed to somebody, and an unnamed
                invite has no row to attribute it to. Matches need no
                name, so they stand on their own. */}
                  <InviteStarterPack
                    matches={scope === "all" ? [] : starter.matches}
                    entries={inviteName.trim() ? starter.entries : []}
                    points={starter.points}
                    pickedMatches={pickedMatches}
                    pickedEntries={pickedEntries}
                    disabled={creating}
                    onToggleMatch={(id) =>
                      setPickedMatches((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    onToggleEntry={(id) =>
                      setPickedEntries((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  />
                  {/* Not gated on the scope: "all my matches" is about matches
                and says nothing about the journal, so the offer to share
                entries stands either way. Gating it here hid the whole
                head start behind the default choice. */}
                  {!inviteName.trim() && starter.entries.length > 0 && (
                    <p className="mt-3 text-sm text-zinc-400">
                      Name them above to send some of your journal too.
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => void createLink()}
                    className="glow-cta mt-4 w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
                  >
                    {creating ? "Creating…" : "Create invite link"}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-400">
                    It is waiting until they open it. You can revoke it any time
                    from Coaching.
                  </p>
                  <p className="mt-3 break-all rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-xs text-zinc-300">
                    {link}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void copy()}
                      className="flex-1 rounded-full bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink"
                    >
                      {copied ? "Copied" : "Copy link"}
                    </button>
                    {canNativeShare && (
                      <button
                        type="button"
                        onClick={() => void nativeShare()}
                        className="flex-1 rounded-full border border-edge bg-surface-2 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
                      >
                        Share…
                      </button>
                    )}
                  </div>
                  <ShareQR url={link} />
                  <button
                    type="button"
                    onClick={() => {
                      setLink(null);
                      setInviteName("");
                      setCopied(false);
                      void loadCoaches();
                    }}
                    className="mt-3 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    Invite someone else
                  </button>
                </>
              )}
            </div>
            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ShareWithCoach({
  userId,
  matchId,
  onLinkCreated,
  buttonClassName,
  label = "Share with coach",
}: {
  userId: string;
  matchId?: string;
  onLinkCreated?: () => void;
  buttonClassName?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          buttonClassName ??
          "rounded-full border border-edge bg-surface-2 px-5 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white"
        }
      >
        {label}
      </button>
      <ShareWithCoachSheet
        open={open}
        onClose={() => setOpen(false)}
        userId={userId}
        matchId={matchId}
        onLinkCreated={onLinkCreated}
      />
    </>
  );
}
