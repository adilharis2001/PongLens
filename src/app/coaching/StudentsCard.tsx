"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { entryTitle, studentSummary } from "@/lib/coach/entryView";
import { createClient } from "@/lib/supabase/client";

/**
 * The coaching workspace's home card on /coaching (157): the roster at a
 * glance and the latest entries. It exists because a coach without a
 * marketplace page used to land on the player-side view of this page
 * after switching to coaching — a home that said "Add a coach" to a coach.
 */

interface StudentRow {
  id: string;
  player_id: string | null;
  display_name: string;
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
  takeaways: { title?: string | null } | null;
}

export function StudentsCard() {
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [lessons, setLessons] = useState<Record<string, LessonRow>>({});
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [studentsRes, entriesRes, lessonsRes, matchesRes] =
        await Promise.all([
          supabase
            .from("coach_students")
            .select("id, player_id, display_name")
            .eq("coach_id", user.id)
            .is("archived_at", null)
            .order("created_at", { ascending: false }),
          supabase
            .from("coach_entries")
            .select("id, student_id, lesson_id, shared_at, created_at")
            .eq("coach_id", user.id)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("lessons")
            .select("id, transcript, takeaways")
            .eq("kind", "coach")
            .order("created_at", { ascending: false })
            .limit(20),
          supabase.from("matches").select("id, user_id").neq("user_id", user.id),
        ]);
      if (!alive) return;
      setStudents((studentsRes.data as StudentRow[]) ?? []);
      setEntries((entriesRes.data as EntryRow[]) ?? []);
      const byId: Record<string, LessonRow> = {};
      for (const l of (lessonsRes.data as LessonRow[]) ?? []) byId[l.id] = l;
      setLessons(byId);
      const perPlayer: Record<string, number> = {};
      for (const m of (matchesRes.data as { user_id: string }[]) ?? []) {
        perPlayer[m.user_id] = (perPlayer[m.user_id] ?? 0) + 1;
      }
      setMatchCounts(perPlayer);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (students === null) return null;

  const entryCounts: Record<string, number> = {};
  for (const e of entries) {
    entryCounts[e.student_id] = (entryCounts[e.student_id] ?? 0) + 1;
  }
  const active = new Set(students.map((s) => s.id));
  const recent = entries.filter((e) => active.has(e.student_id)).slice(0, 3);
  const nameOf = (id: string) =>
    students.find((s) => s.id === id)?.display_name ?? "Student";

  return (
    <div className="mt-6 space-y-6">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Students
          </h2>
          <Link
            href="/coaching/students"
            className="text-sm text-cyan-glow underline-offset-2 hover:underline"
          >
            {students.length === 0 ? "Add a student" : "All students"}
          </Link>
        </div>
        {students.length === 0 ? (
          <div className="rounded-2xl border border-edge bg-surface p-5">
            <p className="text-sm font-medium text-zinc-100">No students yet.</p>
            <p className="mt-1 text-sm text-zinc-400">
              Add a student to start keeping lesson notes. An invite links
              them to their PongLens account, and their matches show up here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
            {students.slice(0, 5).map((s) => (
              <Link
                key={s.id}
                href={`/coaching/students/${s.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-100">
                    {s.display_name}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {studentSummary(
                      Boolean(s.player_id),
                      s.player_id ? (matchCounts[s.player_id] ?? 0) : 0,
                      entryCounts[s.id] ?? 0,
                    )}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Recent entries
          </h2>
          <div className="space-y-3">
            {recent.map((e) => {
              const lesson = lessons[e.lesson_id];
              return (
                <Link
                  key={e.id}
                  href={`/coaching/students/${e.student_id}`}
                  className="block rounded-2xl border border-edge bg-surface p-4 transition-colors hover:bg-surface-2"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-cyan-glow">
                      {nameOf(e.student_id)}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {e.shared_at ? "Shared" : "Draft"}
                    </span>
                  </span>
                  <span className="mt-1 block text-sm font-medium text-zinc-100">
                    {entryTitle(lesson?.transcript, lesson?.takeaways)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
