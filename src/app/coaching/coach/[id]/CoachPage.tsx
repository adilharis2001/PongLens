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
        {/* One list of what this coach has, not two. CoachSharedWith
            already names every entry attributed to them, shared or not,
            with the control that changes it; a second list of the same
            lessons underneath was the same content twice on one screen.
            To read them, the Coaching feed filtered to this coach is one
            tap back. */}
        <SharingSection userId={userId} focusCoachId={coachRefId} />
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
