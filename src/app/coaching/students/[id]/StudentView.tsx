"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entryTitle as entryTitleOf, matchLabel } from "@/lib/coach/entryView";
import { DictateMic, useDictation } from "@/components/dictation";
import {
  AddPhotoButton,
  EntryImage,
  PhotoPreview,
  useEntryPhoto,
} from "@/components/entryPhoto";
import { LinkedText } from "@/components/LinkedText";
import { NoteEditor } from "@/app/journal/NoteEditor";
import type { Lesson, Point } from "@/lib/types";
import { possessive } from "@/lib/coaches/playerCoaches";
import {
  fetchPointsPaged,
  useScoreChips,
  type PointLite,
} from "@/app/dashboard/shared";
import type { CoachStudentRow } from "../StudentsView";

/**
 * The coach's page for one student. Entries are lessons rows (kind
 * 'coach') wrapped with the student they are about; sharing flips the
 * wrapper's shared_at and the student reads the live words. Matches come
 * through the same RLS grant the rest of the app uses.
 */

interface Takeaways {
  title?: string | null;
  themes?: { name: string; points: string[] }[] | null;
}

interface EntryRow {
  id: string;
  student_id: string;
  lesson_id: string;
  shared_at: string | null;
  created_at: string;
}

interface LessonRow {
  id: string;
  transcript: string;
  takeaways: Takeaways | null;
  status: string;
  match_id: string | null;
  image_path: string | null;
  created_at: string;
}

/** One row of student_shared_lessons() (164): a journal entry this
 *  student attributed to you and chose to share. Read-only here — it is
 *  their journal, and it stays theirs. */
interface SharedFromStudent {
  lesson_id: string;
  student_id: string;
  student_name: string;
  transcript: string;
  takeaways: Takeaways | null;
  image_path: string | null;
  match_id: string | null;
  shared_at: string;
  created_at: string;
}

/** The first line of an entry's substance, for a card that is closed.
 *  A title and a date alone tell a coach nothing about whether it is
 *  worth opening; the first thing the student actually wrote does. */
function entryPreview(transcript: string, takeaways: Takeaways | null): string {
  const first = takeaways?.themes?.[0]?.points?.[0];
  const words = (first ?? transcript ?? "").replace(/\s+/g, " ").trim();
  return words.length > 120 ? `${words.slice(0, 120)}…` : words;
}

interface MatchRow {
  id: string;
  opponent_name: string | null;
  original_name: string | null;
  match_type: string | null;
  venue: string | null;
  played_at: string;
  status: string;
}

function day(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function entryTitle(lesson: LessonRow | undefined): string {
  return entryTitleOf(lesson?.transcript, lesson?.takeaways);
}

const pill =
  "rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white";

export function StudentView({
  userId,
  initialStudent,
  offlineStudents,
}: {
  userId: string;
  initialStudent: CoachStudentRow;
  /** Rows on this roster still waiting for an account (161). */
  offlineStudents: CoachStudentRow[];
}) {
  const router = useRouter();
  const [student, setStudent] = useState(initialStudent);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [lessons, setLessons] = useState<Record<string, LessonRow>>({});
  const [matches, setMatches] = useState<MatchRow[]>([]);
  /** Their journal entries, shared with you (164). */
  const [fromStudent, setFromStudent] = useState<SharedFromStudent[]>([]);
  const [openShared, setOpenShared] = useState<string | null>(null);
  /** Just enough of each point to read the score off a student's matches.
   *  The same walk the player's own library runs, so a coach and a player
   *  can never be looking at two different scores for one match. */
  const [matchPoints, setMatchPoints] = useState<PointLite[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  /** The entry being corrected, in the shape the journal's editor takes. */
  const [editing, setEditing] = useState<Lesson | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [improve, setImprove] = useState(true);
  const [saving, setSaving] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteFailed, setInviteFailed] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const scoreChips = useScoreChips(matchPoints);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [entriesRes, lessonsRes, studentRes] = await Promise.all([
      supabase
        .from("coach_entries")
        .select("id, student_id, lesson_id, shared_at, created_at")
        .eq("student_id", initialStudent.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("lessons")
        .select(
          "id, transcript, takeaways, status, match_id, image_path, created_at",
        )
        .eq("kind", "coach"),
      supabase
        .from("coach_students")
        .select("*")
        .eq("id", initialStudent.id)
        .maybeSingle(),
    ]);
    setEntries((entriesRes.data as EntryRow[]) ?? []);
    const byId: Record<string, LessonRow> = {};
    for (const l of (lessonsRes.data as LessonRow[]) ?? []) byId[l.id] = l;
    setLessons(byId);
    const fresh = studentRes.data as CoachStudentRow | null;
    if (fresh) setStudent(fresh);
    if (fresh?.player_id) {
      const playerId = fresh.player_id;
      const [{ data: matchRows }, { data: sharedRows }] = await Promise.all([
        supabase
          .from("matches")
          .select(
            "id, opponent_name, original_name, match_type, venue, played_at, status",
          )
          .eq("user_id", playerId)
          .order("created_at", { ascending: false }),
        // Every student's shared entries come back; this page wants one
        // student's. Filtering here rather than parameterising the RPC
        // keeps the access rule in a function that takes no arguments,
        // which is one fewer thing a caller can get wrong.
        supabase.rpc("student_shared_lessons"),
      ]);
      const rows = (matchRows as MatchRow[]) ?? [];
      setMatches(rows);
      // Scores for the matches actually on screen. Ready matches only:
      // one that is still processing has no points to walk.
      const ready = rows.filter((m) => m.status === "ready").map((m) => m.id);
      if (ready.length > 0) {
        void fetchPointsPaged<PointLite>(
          "id, match_id, idx, t0, is_let, confirmed_winner, game_end_override, game_winner_override",
          ready,
        ).then((pts) => setMatchPoints(pts));
      }
      setFromStudent(
        ((sharedRows as SharedFromStudent[]) ?? []).filter(
          (r) => r.student_id === playerId,
        ),
      );
    }
  }, [initialStudent.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (line: string) => {
    setNotice(line);
    setTimeout(() => setNotice(null), 2500);
  };

  // The same three pieces the player's journal composer uses, shared
  // rather than copied: dictation, one moderated photo, and the improve
  // switch this composer did not have at all until now. It always
  // improved, silently, while the app asked.
  const appendToDraft = useCallback((words: string) => {
    setDraft((d) => (d.trim() ? `${d.trim()}\n\n${words}` : words));
  }, []);
  const dictation = useDictation({
    onText: appendToDraft,
    onError: setComposerError,
  });
  const {
    photo,
    attach: attachPhoto,
    discard: discardPhoto,
    release: releasePhoto,
  } = useEntryPhoto(setComposerError);

  const closeComposer = () => {
    dictation.cancel();
    discardPhoto();
    setComposerError(null);
    setComposerOpen(false);
  };

  /** A student who joined from the general invite link, folded into the
   *  row the coach had already typed: entries move, the typed name stays,
   *  the account binds to it (161). */
  const mergeInto = async (target: CoachStudentRow) => {
    setMergeBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("merge_students", {
      p_into: target.id,
      p_from: student.id,
    });
    if (error) {
      setMergeBusy(false);
      flash("Couldn't merge them. Try again.");
      return;
    }
    router.replace(`/coaching/students/${target.id}`);
    router.refresh();
  };

  const saveEntry = async () => {
    const words = draft.trim();
    if (!words) return;
    setSaving(true);
    setComposerError(null);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: words,
          kind: "coach",
          summarize: improve,
          imagePath: photo?.path ?? null,
        }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.id) throw new Error("no id");
      const supabase = createClient();
      const { error } = await supabase.from("coach_entries").insert({
        coach_id: userId,
        student_id: student.id,
        lesson_id: data.id,
      });
      if (error) {
        // Never leak a lesson into nobody's journal.
        await fetch("/api/journal-entry", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryId: data.id }),
        });
        throw error;
      }
      setDraft("");
      setImprove(true);
      // The entry owns the photo now, so let go of it without deleting.
      releasePhoto();
      setComposerOpen(false);
      void load();
    } catch {
      flash("Couldn't save the entry. Try again.");
    }
    setSaving(false);
  };

  /** The journal's editor takes a full Lesson. A coach entry is one: the
   *  coach is its author, its kind is 'coach', and it never has a coach
   *  name of its own. */
  const asLesson = (lesson: LessonRow): Lesson => ({
    id: lesson.id,
    user_id: userId,
    match_id: lesson.match_id,
    transcript: lesson.transcript,
    takeaways: lesson.takeaways as Lesson["takeaways"],
    status: (lesson.status === "ready" || lesson.status === "failed"
      ? lesson.status
      : "queued") as Lesson["status"],
    kind: "coach",
    coach_name: null,
    image_path: lesson.image_path,
    created_at: lesson.created_at,
  });

  const setShared = async (entry: EntryRow, shared: boolean) => {
    setSharingId(entry.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("coach_entries")
      .update({ shared_at: shared ? new Date().toISOString() : null })
      .eq("id", entry.id);
    if (error) flash("Couldn't change sharing. Try again.");
    await load();
    setSharingId(null);
  };

  const deleteEntry = async (entry: EntryRow) => {
    if (!window.confirm("Delete this entry?")) return;
    const res = await fetch("/api/journal-entry", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId: entry.lesson_id }),
    });
    if (!res.ok) {
      flash("Couldn't delete it. Try again.");
      return;
    }
    void load();
  };

  const copyEntryLink = async (entry: EntryRow) => {
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("share_links")
      .select("token")
      .eq("kind", "entry")
      .eq("lesson_id", entry.lesson_id)
      .is("revoked_at", null)
      .limit(1);
    let token = existing?.[0]?.token as string | undefined;
    if (!token) {
      const minted = crypto.randomUUID().replaceAll("-", "");
      const { data: inserted } = await supabase
        .from("share_links")
        .insert({
          owner: userId,
          kind: "entry",
          lesson_id: entry.lesson_id,
          token: minted,
          title: entryTitle(lessons[entry.lesson_id]),
        })
        .select("token")
        .single();
      token = (inserted?.token as string | undefined) ?? undefined;
      if (!token) {
        // Lost a race with another tab: the live link exists, read it.
        const { data: retry } = await supabase
          .from("share_links")
          .select("token")
          .eq("kind", "entry")
          .eq("lesson_id", entry.lesson_id)
          .is("revoked_at", null)
          .limit(1);
        token = retry?.[0]?.token as string | undefined;
      }
    }
    if (!token) {
      flash("Couldn't get a link. Try again.");
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}/s/${token}`);
    flash("Link copied.");
  };

  const removeStudent = async () => {
    if (
      !window.confirm(
        student.player_id
          ? "Remove this student? They come off your list and you stop seeing their matches. Your entries are kept."
          : "Remove this student? They come off your list. Your entries are kept.",
      )
    )
      return;
    const supabase = createClient();
    const { error } = await supabase.rpc("remove_student", {
      p_student_id: student.id,
    });
    if (error) {
      flash("Couldn't remove them. Try again.");
      return;
    }
    router.replace("/coaching/students");
    router.refresh();
  };

  /** The standing invite link for this student, minted on first ask. */
  const inviteLink = useCallback(async (): Promise<string | null> => {
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("coach_student_invites")
      .select("token")
      .eq("coach_id", userId)
      .eq("student_id", student.id)
      .is("revoked_at", null)
      .limit(1);
    let token = existing?.[0]?.token as string | undefined;
    if (!token) {
      const { data: inserted } = await supabase
        .from("coach_student_invites")
        .insert({ coach_id: userId, student_id: student.id })
        .select("token")
        .single();
      token = (inserted?.token as string | undefined) ?? undefined;
    }
    return token ? `${window.location.origin}/join/${token}` : null;
  }, [student.id, userId]);

  useEffect(() => {
    if (!inviteOpen || inviteUrl) return;
    let cancelled = false;
    void inviteLink().then((url) => {
      if (cancelled) return;
      setInviteUrl(url);
      setInviteFailed(!url);
    });
    return () => {
      cancelled = true;
    };
  }, [inviteOpen, inviteUrl, inviteLink]);

  const copyInvite = async () => {
    const url = inviteUrl ?? (await inviteLink());
    if (!url) {
      flash("Couldn't get the invite link. Try again.");
      return;
    }
    await navigator.clipboard.writeText(url);
    flash("Link copied. Send it to them.");
  };

  const sendInvite = async () => {
    const url = inviteUrl ?? (await inviteLink());
    if (!url) {
      flash("Couldn't get the invite link. Try again.");
      return;
    }
    try {
      await navigator.share({ url });
    } catch {
      // Closed the share sheet.
    }
  };

  /** Turn off every copy of this link that is out there and mint a new
   *  one straight away. For a link that got forwarded too far. */
  const resetInvite = async () => {
    if (
      !window.confirm(
        "Reset this invite link? The old link stops working. You get a new one straight away.",
      )
    )
      return;
    const supabase = createClient();
    const { error } = await supabase
      .from("coach_student_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("coach_id", userId)
      .eq("student_id", student.id)
      .is("revoked_at", null);
    if (error) {
      flash("Couldn't reset the link. Try again.");
      return;
    }
    setInviteUrl(null);
    const fresh = await inviteLink();
    setInviteUrl(fresh);
    setInviteFailed(!fresh);
    flash("The old link is off. This is the new one.");
  };

  const rename = async () => {
    const clean = renameDraft.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!clean) return;
    setRenameBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("coach_students")
      .update({ display_name: clean })
      .eq("id", student.id);
    setRenameBusy(false);
    if (error) {
      flash("Couldn't rename them. Try again.");
      return;
    }
    setStudent((s) => ({ ...s, display_name: clean }));
    setRenameOpen(false);
  };

  return (
    <div>
      <Link
        href="/coaching/students"
        className="text-sm text-zinc-400 transition-colors hover:text-white"
      >
        ← Students
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {student.display_name}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {student.player_id ? "On PongLens" : "Not on PongLens yet"}
        </p>
      </div>

      {notice && <p className="mt-3 text-sm text-cyan-glow">{notice}</p>}

      <button
        type="button"
        onClick={() => (composerOpen ? closeComposer() : setComposerOpen(true))}
        className="glow-cta mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink sm:w-auto sm:py-2"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"
          />
        </svg>
        New entry
      </button>

      {composerOpen && (
        <div className="mt-4 rounded-2xl border border-edge bg-surface p-4">
          <div className="relative">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              placeholder="What you worked on, what to fix, what comes next."
              aria-label="Entry text"
              className="w-full resize-y rounded-xl border border-edge bg-ink/40 px-3 py-2 pb-11 text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
            />
            {/* the mic lives where the words land */}
            <DictateMic
              state={dictation.state}
              onStart={() => void dictation.start()}
              onStop={dictation.stop}
            />
          </div>
          {dictation.state === "writing" && (
            <p className="mt-2 animate-pulse text-xs text-zinc-400">
              Writing that down…
            </p>
          )}

          <div className="mt-2.5">
            <AddPhotoButton
              disabled={!!photo}
              onPick={(file) => void attachPhoto(file)}
            />
          </div>
          {photo && <PhotoPreview photo={photo} onRemove={discardPhoto} />}

          <div className="mt-3">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={improve}
                onChange={(e) => setImprove(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-cyan-glow,#22d3ee)]"
              />
              <span>
                Improve with AI
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Your rough notes become clear, simple points. You can edit
                  them afterwards.
                </span>
              </span>
            </label>
          </div>

          {composerError && (
            <p className="mt-2 text-xs text-red-400">{composerError}</p>
          )}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void saveEntry()}
              disabled={
                saving ||
                !draft.trim() ||
                photo?.checking === true ||
                dictation.state !== "idle"
              }
              className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60 sm:w-auto sm:py-2"
            >
              {saving
                ? improve
                  ? "Reading it through…"
                  : "Saving…"
                : "Save entry"}
            </button>
            <button type="button" onClick={closeComposer} className={pill}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!student.player_id && (
        <div className="mt-5 rounded-2xl border border-edge bg-surface p-4 sm:p-5">
          <p className="text-base font-semibold text-zinc-100">
            Connect {student.display_name}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            An invite links them to their PongLens account. You&apos;ll see the
            matches they upload, and the entries you share reach their journal.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-edge bg-ink/40">
            <button
              type="button"
              onClick={() => setInviteOpen((v) => !v)}
              aria-expanded={inviteOpen}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0 text-zinc-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"
                />
              </svg>
              <span className="flex-1">Invite {student.display_name}</span>
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${inviteOpen ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m9 6 6 6-6 6"
                />
              </svg>
            </button>
            {inviteOpen && (
              <div className="border-t border-edge/60 px-4 py-4">
                <p className="text-sm leading-relaxed text-zinc-400">
                  Opening this link and signing in connects{" "}
                  {student.display_name} to this row. They choose whether you
                  see all their matches or only the ones they share.
                </p>
                {inviteUrl ? (
                  <p className="mt-3 break-all rounded-lg bg-ink/60 px-3 py-2 font-mono text-xs text-zinc-300">
                    {inviteUrl}
                  </p>
                ) : inviteFailed ? (
                  <p className="mt-3 text-sm text-amber-200">
                    Couldn&apos;t get the link. Close this and try again.
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">
                    Getting the link…
                  </p>
                )}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={() => void copyInvite()}
                    disabled={!inviteUrl}
                    className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60 sm:w-auto sm:py-2"
                  >
                    Copy link
                  </button>
                  {typeof navigator !== "undefined" && "share" in navigator && (
                    <button
                      type="button"
                      onClick={() => void sendInvite()}
                      disabled={!inviteUrl}
                      className={`${pill} w-full py-2.5 text-center disabled:opacity-60 sm:w-auto sm:py-1.5`}
                    >
                      Send the link
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void resetInvite()}
                    disabled={!inviteUrl}
                    className="w-full rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-60 sm:w-auto sm:py-1.5"
                  >
                    Reset link
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <h3 className="mt-8 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Journal
      </h3>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No entries yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {entries.map((entry) => {
            const lesson = lessons[entry.lesson_id];
            const expanded = open === entry.id;
            const themes = lesson?.takeaways?.themes ?? [];
            // The share sits on the card, not inside it: a coach writing
            // in a student's folder assumes the student can read it.
            const canShare = Boolean(student.player_id) && !entry.shared_at;
            return (
              <div
                key={entry.id}
                className="rounded-2xl border border-edge bg-surface p-4"
              >
                {/* A row, not one button: the share sits in the same
                    corner as the Shared badge it replaces, and a button
                    cannot be nested inside a button (Adil, 2026-09-04).
                    It used to be a full-width cyan bar under the entry,
                    which shouted next to a badge that whispers. */}
                <div className="flex w-full items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : entry.id)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    {/* The photo is half of what an entry says, so the row
                        that stands for the entry shows it. */}
                    {lesson?.image_path && (
                      <EntryImage
                        lessonId={lesson.id}
                        className="h-11 w-11 shrink-0 rounded-lg border border-edge object-cover"
                      />
                    )}
                    <span className="min-w-0 text-sm font-medium text-zinc-100">
                      {entryTitle(lesson)}
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    {entry.shared_at ? (
                      <span className="rounded-full bg-cyan-glow/10 px-2 py-0.5 text-[11px] font-medium text-cyan-glow">
                        Shared
                      </span>
                    ) : (
                      canShare && (
                        // Sized against the badge beside it, but drawn as
                        // a control: a ring, a filled ground and a hover,
                        // so it does not read as another status word.
                        <button
                          type="button"
                          onClick={() => void setShared(entry, true)}
                          disabled={sharingId === entry.id}
                          className="rounded-full border border-cyan-glow/60 bg-cyan-glow/10 px-3 py-1 text-xs font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/20 disabled:opacity-60"
                        >
                          {sharingId === entry.id ? "Sharing…" : "Share"}
                        </button>
                      )
                    )}
                    <span className="text-xs text-zinc-500">
                      {day(entry.created_at)}
                    </span>
                  </span>
                </div>
                {expanded && (
                  <div className="mt-3 space-y-4">
                    {themes.length > 0 ? (
                      <>
                        {themes.map((theme) => (
                          <div key={theme.name}>
                            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-glow">
                              {theme.name}
                            </p>
                            <ul className="mt-2 space-y-1.5">
                              {theme.points.map((point) => (
                                <li
                                  key={point}
                                  className="flex gap-2 text-sm text-zinc-200"
                                >
                                  <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                                  <span className="leading-relaxed">
                                    <LinkedText text={point} />
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        <details className="text-sm text-zinc-400">
                          <summary className="cursor-pointer select-none">
                            Transcript
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap leading-relaxed text-zinc-300">
                            <LinkedText text={lesson?.transcript ?? ""} />
                          </p>
                        </details>
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                        <LinkedText text={lesson?.transcript ?? ""} />
                      </p>
                    )}
                    {lesson?.image_path && <EntryImage lessonId={lesson.id} />}
                  </div>
                )}
                {expanded && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-edge/60 pt-3">
                    {student.player_id && entry.shared_at && (
                      <button
                        type="button"
                        onClick={() => void setShared(entry, false)}
                        disabled={sharingId === entry.id}
                        className={pill}
                      >
                        {sharingId === entry.id ? "Stopping…" : "Stop sharing"}
                      </button>
                    )}
                    {lesson && (
                      <button
                        type="button"
                        onClick={() => setEditing(asLesson(lesson))}
                        className={pill}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void copyEntryLink(entry)}
                      className={pill}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteEntry(entry)}
                      className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-500/60 hover:text-amber-200"
                    >
                      Delete
                    </button>
                  </div>
                )}
                {expanded && entry.shared_at && (
                  <p className="mt-3 text-xs text-zinc-500">
                    Shared with {student.display_name}. Edits show on their
                    side.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Their journal, the half they chose to show you (164). Read-only
          and clearly theirs: the entries above are yours, written about
          them, and the two must never look like one pile. */}
      {student.player_id && fromStudent.length > 0 && (
        <>
          <h3 className="mt-8 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {/* Their journal, named as such. "From <name>" read like a
                message addressed to the coach, something to act on,
                rather than a window onto what the student keeps for
                themselves (Adil, 2026-09-04). */}
            {possessive(student.display_name)} journal
          </h3>
          <div className="mt-3 space-y-2">
            {fromStudent.map((entry) => {
              const isOpen = openShared === entry.lesson_id;
              return (
                <div
                  key={entry.lesson_id}
                  className="overflow-hidden rounded-2xl border border-edge bg-surface"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenShared(isOpen ? null : entry.lesson_id)
                    }
                    aria-expanded={isOpen}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-zinc-100">
                        {entryTitleOf(entry.transcript, entry.takeaways)}
                      </span>
                      <span className="mt-0.5 block text-xs text-zinc-500">
                        {day(entry.created_at)}
                      </span>
                      {!isOpen && (
                        <span className="mt-1.5 block line-clamp-2 text-sm leading-relaxed text-zinc-400">
                          {entryPreview(entry.transcript, entry.takeaways)}
                        </span>
                      )}
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      className={`mt-0.5 h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m6 9 6 6 6-6"
                      />
                    </svg>
                  </button>
                  {isOpen && (
                    <div className="border-t border-edge/60 px-4 py-3">
                      {entry.image_path && (
                        <EntryImage
                          lessonId={entry.lesson_id}
                          className="mb-3"
                        />
                      )}
                      {entry.takeaways?.themes?.length ? (
                        <div className="space-y-3">
                          {entry.takeaways.themes.map((theme) => (
                            <div key={theme.name}>
                              <p className="text-xs font-semibold uppercase tracking-wider text-cyan-glow/80">
                                {theme.name}
                              </p>
                              <ul className="mt-1 space-y-1">
                                {theme.points.map((point) => (
                                  <li
                                    key={point}
                                    className="text-sm leading-relaxed text-zinc-300"
                                  >
                                    <LinkedText text={point} />
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                          <LinkedText text={entry.transcript} />
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {student.player_id && (
        <>
          <h3 className="mt-8 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Matches
          </h3>
          {matches.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">Nothing shared yet.</p>
          ) : (
            /* Cards, not a list of names (Adil, 2026-09-04). A coach
               opening a new student should be able to SEE what they have
               been doing — the picture, who it was against, and how it
               went — rather than read a stack of dates and click each one
               to find out. The thumb comes from /api/thumb/<id>, whose URL
               never changes and whose access is has_match_access, so it
               works for a coach without signing anything. */
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {matches.map((match) => {
                const score = scoreChips.get(match.id);
                return (
                  <Link
                    key={match.id}
                    href={`/match/${match.id}`}
                    className="group flex gap-3 overflow-hidden rounded-2xl border border-edge bg-surface p-2.5 transition-colors hover:border-cyan-glow/40"
                  >
                    <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-surface-2/60 sm:w-32">
                      {match.status === "ready" ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={`/api/thumb/${match.id}`}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
                          {match.status === "failed" ? "Failed" : "Working"}
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-0.5 pr-1">
                      <span className="truncate text-sm font-semibold text-zinc-100">
                        {matchLabel(match)}
                      </span>
                      <span className="truncate text-xs text-zinc-500">
                        {/* The date and where, not the date twice: the
                            title already carries the opponent, and
                            deriveMatchTitleParts' secondary IS the date. */}
                        {[day(match.played_at), match.venue]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {score && (
                        /* The games, read by the same walk the player's
                           own library runs, so the two can never disagree.
                           A match still being scored says so rather than
                           showing a number that will move. */
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="rounded-full border border-edge bg-ink/50 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-200">
                            {score.you}
                            <span className="text-zinc-600">–</span>
                            {score.them}
                          </span>
                          {!score.complete && (
                            <span className="text-xs text-zinc-600">
                              in progress
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}

      <h3 className="mt-8 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Manage
      </h3>
      <div className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
        <ManageRow
          label="Rename"
          onClick={() => {
            setRenameDraft(student.display_name);
            setMergeOpen(false);
            setRenameOpen((v) => !v);
          }}
        />
        {student.player_id && offlineStudents.length > 0 && (
          <ManageRow
            label="Same as an existing student"
            onClick={() => {
              setRenameOpen(false);
              setMergeOpen((v) => !v);
            }}
          />
        )}
        <ManageRow
          label="Remove from students"
          danger
          onClick={() => void removeStudent()}
        />
      </div>

      {renameOpen && (
        <div className="mt-4 rounded-2xl border border-edge bg-surface p-4">
          <input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void rename();
            }}
            placeholder="Their name"
            aria-label="Their name"
            className="w-full rounded-xl border border-edge bg-ink/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void rename()}
              disabled={renameBusy || !renameDraft.trim()}
              className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60 sm:w-auto sm:py-2"
            >
              {renameBusy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className={pill}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mergeOpen && student.player_id && offlineStudents.length > 0 && (
        <div className="mt-4 rounded-2xl border border-cyan-glow/30 bg-surface p-4 sm:p-5">
          <p className="text-sm font-medium text-zinc-100">
            Which student are they?
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Your entries about them come along, and their account connects to
            that name.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {offlineStudents.map((row) => (
              <button
                key={row.id}
                type="button"
                disabled={mergeBusy}
                onClick={() => void mergeInto(row)}
                className="glow-cta w-full rounded-full bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-60 sm:w-auto sm:py-1.5"
              >
                {row.display_name}
              </button>
            ))}
            <button
              type="button"
              disabled={mergeBusy}
              onClick={() => setMergeOpen(false)}
              className={`${pill} w-full py-2.5 text-center sm:w-auto sm:py-1.5`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Correcting an entry: the journal's own editor, which already
          knows that an entry with points is corrected point by point and
          one without has its words edited instead. */}
      <NoteEditor
        lesson={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setLessons((all) => ({
            ...all,
            [saved.id]: {
              ...all[saved.id],
              transcript: saved.transcript,
              takeaways: saved.takeaways as Takeaways | null,
              status: saved.status,
              // The photo can be swapped or taken off in the editor, so
              // the row it came from has to hear about that too.
              image_path: saved.image_path ?? null,
            },
          }));
          setEditing(null);
        }}
      />
    </div>
  );
}

/** One row of the Manage group: label, chevron, the Account page's grammar. */
function ManageRow({
  label,
  danger = false,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium transition-colors hover:bg-surface-2 ${
        danger ? "text-red-300" : "text-zinc-200"
      }`}
    >
      {label}
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-zinc-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
      </svg>
    </button>
  );
}
