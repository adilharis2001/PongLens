"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FirstStudentCard } from "../FirstStudentCard";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { studentSummary } from "@/lib/coach/entryView";

export interface CoachStudentRow {
  id: string;
  coach_id: string;
  player_id: string | null;
  display_name: string;
  created_at: string;
  archived_at: string | null;
}

export function StudentsView({ userId }: { userId: string }) {
  const [students, setStudents] = useState<CoachStudentRow[] | null>(null);
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({});
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  // ?add=1 opens the form straight away — the checklist's "Add your
  // first student" lands here with nothing else to tap.
  const searchParams = useSearchParams();
  const [addOpen, setAddOpen] = useState(searchParams.get("add") === "1");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [studentsRes, entriesRes, matchesRes] = await Promise.all([
      supabase
        .from("coach_students")
        .select("*")
        .eq("coach_id", userId)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("coach_entries").select("id, student_id"),
      supabase.from("matches").select("id, user_id").neq("user_id", userId),
    ]);
    const rows = (studentsRes.data as CoachStudentRow[]) ?? [];
    setStudents(rows);
    const perStudent: Record<string, number> = {};
    for (const e of (entriesRes.data as { student_id: string }[]) ?? []) {
      perStudent[e.student_id] = (perStudent[e.student_id] ?? 0) + 1;
    }
    setEntryCounts(perStudent);
    const perPlayer: Record<string, number> = {};
    for (const m of (matchesRes.data as { user_id: string }[]) ?? []) {
      perPlayer[m.user_id] = (perPlayer[m.user_id] ?? 0) + 1;
    }
    setMatchCounts(perPlayer);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const clean = newName.replace(/\s+/g, " ").trim();
    if (!clean) {
      setError("Enter their name to add them.");
      return;
    }
    setAdding(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("coach_students")
      .insert({ coach_id: userId, display_name: clean.slice(0, 80) });
    setAdding(false);
    if (insertError) {
      setError("Couldn't add them. Try again.");
      return;
    }
    setNewName("");
    setAddOpen(false);
    void load();
  };

  const summary = (student: CoachStudentRow) =>
    studentSummary(
      Boolean(student.player_id),
      student.player_id ? (matchCounts[student.player_id] ?? 0) : 0,
      entryCounts[student.id] ?? 0,
    );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Students
        </h1>
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
        >
          Add a student
        </button>
      </div>

      {addOpen && (
        <div className="mt-4 rounded-2xl border border-edge bg-surface p-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder="Their name"
            className="w-full rounded-xl border border-edge bg-ink/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
          />
          <p className="mt-2 text-xs text-zinc-500">
            They don&apos;t need the app for you to keep notes. Invite them
            later and everything connects.
          </p>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <button
            type="button"
            onClick={() => void add()}
            disabled={adding}
            className="glow-cta mt-3 w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60 sm:w-auto sm:py-2"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      )}

      <div className="mt-6">
        {students === null ? null : students.length === 0 ? (
          // The same card the hub shows, so the two places a new coach
          // lands say the same thing. Its Add row opens the form already
          // on this page rather than navigating to it.
          <FirstStudentCard
            coachId={userId}
            onAddStudent={() => setAddOpen(true)}
          />
        ) : (
          <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface">
            {students.map((student) => (
              <Link
                key={student.id}
                href={`/coaching/students/${student.id}`}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 text-sm font-semibold ${
                    student.player_id ? "text-cyan-glow" : "text-zinc-500"
                  }`}
                >
                  {student.display_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-100">
                    {student.display_name}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {summary(student)}
                  </span>
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 text-zinc-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
