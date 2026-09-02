"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entryTitle as entryTitleOf, matchLabel } from "@/lib/coach/entryView";
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
  created_at: string;
}

interface MatchRow {
  id: string;
  opponent_name: string | null;
  original_name: string | null;
  match_type: string | null;
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
}: {
  userId: string;
  initialStudent: CoachStudentRow;
}) {
  const router = useRouter();
  const [student, setStudent] = useState(initialStudent);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [lessons, setLessons] = useState<Record<string, LessonRow>>({});
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
        .select("id, transcript, takeaways, status, match_id, created_at")
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
      const { data: matchRows } = await supabase
        .from("matches")
        .select("id, opponent_name, original_name, match_type, played_at, status")
        .eq("user_id", fresh.player_id)
        .order("created_at", { ascending: false });
      setMatches((matchRows as MatchRow[]) ?? []);
    }
  }, [initialStudent.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (line: string) => {
    setNotice(line);
    setTimeout(() => setNotice(null), 2500);
  };

  const saveEntry = async () => {
    const words = draft.trim();
    if (!words) return;
    setSaving(true);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: words, kind: "coach" }),
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
      setComposerOpen(false);
      void load();
    } catch {
      flash("Couldn't save the entry. Try again.");
    }
    setSaving(false);
  };

  const setShared = async (entry: EntryRow, shared: boolean) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("coach_entries")
      .update({ shared_at: shared ? new Date().toISOString() : null })
      .eq("id", entry.id);
    if (error) flash("Couldn't change sharing. Try again.");
    void load();
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

  /** Turn off every live invite link for this student; the next copy
   *  mints a fresh one. For a link that got forwarded too far. */
  const resetInvite = async () => {
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
    flash("Old invite links are off. Copy a new one when you're ready.");
  };

  const copyInvite = async () => {
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
    if (!token) {
      flash("Couldn't get the invite link. Try again.");
      return;
    }
    await navigator.clipboard.writeText(
      `${window.location.origin}/join/${token}`,
    );
    flash("Invite link copied. Send it to them.");
  };

  return (
    <div>
      <Link
        href="/coaching/students"
        className="text-sm text-zinc-400 transition-colors hover:text-white"
      >
        ← Students
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {student.display_name}
          </h1>
          {!student.player_id && (
            <p className="mt-1 text-sm text-zinc-500">Not on PongLens yet</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setComposerOpen((v) => !v)}
            className={pill}
          >
            New entry
          </button>
          {!student.player_id && (
            <>
              <button type="button" onClick={() => void copyInvite()} className={pill}>
                Copy invite link
              </button>
              <button type="button" onClick={() => void resetInvite()} className={pill}>
                Reset invite link
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void removeStudent()}
            className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-500/60 hover:text-amber-200"
          >
            Remove
          </button>
        </div>
      </div>

      {notice && <p className="mt-3 text-sm text-cyan-glow">{notice}</p>}

      {composerOpen && (
        <div className="mt-4 rounded-2xl border border-edge bg-surface p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder="What you worked on, what to fix, what comes next."
            className="w-full resize-y rounded-xl border border-edge bg-ink/40 px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void saveEntry()}
              disabled={saving || !draft.trim()}
              className="glow-cta rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save entry"}
            </button>
            <button
              type="button"
              onClick={() => setComposerOpen(false)}
              className={pill}
            >
              Cancel
            </button>
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
            return (
              <div
                key={entry.id}
                className="rounded-2xl border border-edge bg-surface p-4"
              >
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : entry.id)}
                  className="flex w-full items-baseline justify-between gap-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-100">
                      {entryTitle(lesson)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {entry.shared_at ? (
                      <span className="rounded-full bg-cyan-glow/10 px-2 py-0.5 text-[11px] font-medium text-cyan-glow">
                        Shared
                      </span>
                    ) : (
                      <span className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-zinc-500">
                        Draft
                      </span>
                    )}
                    <span className="text-xs text-zinc-500">
                      {day(entry.created_at)}
                    </span>
                  </span>
                </button>
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
                                    {point}
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
                            {lesson?.transcript}
                          </p>
                        </details>
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                        {lesson?.transcript}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 border-t border-edge/60 pt-3">
                      {student.player_id ? (
                        entry.shared_at ? (
                          <button
                            type="button"
                            onClick={() => void setShared(entry, false)}
                            className={pill}
                          >
                            Stop sharing
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void setShared(entry, true)}
                            className="glow-cta rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink"
                          >
                            Share with {student.display_name}
                          </button>
                        )
                      ) : null}
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
                    {entry.shared_at && (
                      <p className="text-xs text-zinc-500">
                        Shared with {student.display_name}. Edits show on
                        their side.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {student.player_id && (
        <>
          <h3 className="mt-8 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Matches
          </h3>
          {matches.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">Nothing shared yet.</p>
          ) : (
            <div className="mt-3 divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface">
              {matches.map((match) => (
                <Link
                  key={match.id}
                  href={`/match/${match.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-100">
                      {matchLabel(match)}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {day(match.played_at)}
                    </span>
                  </span>
                  {match.status !== "ready" && (
                    <span className="shrink-0 text-xs text-zinc-500">
                      {match.status === "failed" ? "Failed" : "Processing"}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
