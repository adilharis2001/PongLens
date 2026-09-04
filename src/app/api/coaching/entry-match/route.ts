import { NextResponse } from "next/server";
import {
  parseEntryMatchRequest,
  setCoachEntryMatch,
  type EntryMatchRepository,
} from "@/lib/coach/entryMatch";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * PATCH /api/coaching/entry-match
 *
 * Links or unlinks the lesson behind one coach entry. Every query uses the
 * caller's Supabase session, so RLS hides other coaches' roster, entries,
 * lessons, and matches before the explicit relationship checks run.
 */
export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let request;
  try {
    request = parseEntryMatchRequest(await req.json());
  } catch {
    request = null;
  }
  if (!request) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const data: EntryMatchRepository = {
    async entry(id) {
      const { data: row } = await supabase
        .from("coach_entries")
        .select("id, coach_id, student_id, lesson_id")
        .eq("id", id)
        .maybeSingle();
      return row
        ? {
            id: row.id,
            coachId: row.coach_id,
            studentId: row.student_id,
            lessonId: row.lesson_id,
          }
        : null;
    },
    async student(id) {
      const { data: row } = await supabase
        .from("coach_students")
        .select("id, coach_id, player_id")
        .eq("id", id)
        .maybeSingle();
      return row
        ? {
            id: row.id,
            coachId: row.coach_id,
            playerId: row.player_id,
          }
        : null;
    },
    async lesson(id) {
      const { data: row } = await supabase
        .from("lessons")
        .select("id, user_id, kind")
        .eq("id", id)
        .maybeSingle();
      return row
        ? { id: row.id, userId: row.user_id, kind: row.kind }
        : null;
    },
    async match(id) {
      const { data: row } = await supabase
        .from("matches")
        .select("id, user_id")
        .eq("id", id)
        .maybeSingle();
      return row ? { id: row.id, userId: row.user_id } : null;
    },
    async updateLessonMatch(lessonId, matchId) {
      const { error } = await supabase
        .from("lessons")
        .update({ match_id: matchId })
        .eq("id", lessonId);
      return !error;
    },
  };

  const result = await setCoachEntryMatch(data, user.id, request);
  if (result === "not_found") {
    return NextResponse.json({ error: "Entry or match not found" }, { status: 404 });
  }
  if (result === "failed") {
    return NextResponse.json(
      { error: "Couldn't link the match. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
