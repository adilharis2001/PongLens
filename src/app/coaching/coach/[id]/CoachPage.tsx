"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SharingSection } from "@/components/SharingSection";
import { createClient } from "@/lib/supabase/client";
import { shortDate } from "@/lib/matchTitle";

/**
 * One coach, everything between you and them.
 *
 * The body is SharingSection in focus mode: it already owns their standing,
 * a waiting invite's link and revoke, the access pair, the matches and
 * entries they hold, the rename and the merge and the way out — all of it
 * written once, for the list at /coaching/coach and for this page. What
 * this page adds is the lessons themselves, which slot in between what
 * they can see and Manage.
 */
export function CoachPage({
  userId,
  coachRefId,
  displayName,
}: {
  userId: string;
  coachRefId: string;
  displayName: string;
}) {
  return (
    <div>
      <Link
        href="/coaching"
        className="text-sm text-zinc-400 transition-colors hover:text-white"
      >
        ← Coaching
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
        {displayName}
      </h1>
      <div className="mt-6">
        {/* Two lists that answer two questions. SharingSection says what
            this coach can SEE, each line with the control that changes
            it; the list it wraps says what the two of you have DONE, to
            read. The titles overlap and the jobs do not. */}
        <SharingSection userId={userId} focusCoachId={coachRefId}>
          <LessonsWithCoach coachRefId={coachRefId} />
        </SharingSection>
      </div>
    </div>
  );
}

/** One row of the lessons list. */
interface LessonRow {
  id: string;
  transcript: string | null;
  takeaways: { title?: string | null } | null;
  lesson_video_id: string | null;
  shared_with_coach_at: string | null;
  created_at: string;
}

/**
 * Every lesson attributed to this coach, to read rather than to manage.
 *
 * Read straight from `lessons` under RLS, which is author-only, so this
 * is the player reading their own entries and no wider grant is involved.
 */
function LessonsWithCoach({ coachRefId }: { coachRefId: string }) {
  const [rows, setRows] = useState<LessonRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void createClient()
      .from("lessons")
      .select(
        "id, transcript, takeaways, lesson_video_id, shared_with_coach_at, created_at"
      )
      .eq("coach_ref_id", coachRefId)
      .eq("kind", "lesson")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (alive) setRows((data as LessonRow[] | null) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [coachRefId]);

  if (rows === null || rows.length === 0) return null;

  return (
    <div className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Lessons
      </p>
      <ul className="mt-2 space-y-2">
        {rows.map((l) => {
          const title =
            l.takeaways?.title?.trim() ||
            (l.transcript ?? "").trim().split("\n")[0].slice(0, 80) ||
            "Lesson";
          const body = (
            <>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-100">
                  {title}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {l.lesson_video_id ? "Lesson recap · " : ""}
                  {shortDate(l.created_at)}
                  {l.shared_with_coach_at ? " · Shared" : ""}
                </span>
              </span>
            </>
          );
          return (
            <li
              key={l.id}
              className="rounded-2xl border border-edge bg-surface p-4"
            >
              {l.lesson_video_id ? (
                <Link
                  href={`/lesson-video/${l.lesson_video_id}`}
                  className="flex items-center justify-between gap-3 transition-colors hover:text-white"
                >
                  {body}
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-zinc-600"
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
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
