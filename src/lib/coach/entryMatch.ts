export interface EntryMatchEntry {
  id: string;
  coachId: string;
  studentId: string;
  lessonId: string;
}

export interface EntryMatchStudent {
  id: string;
  coachId: string;
  playerId: string | null;
}

export interface EntryMatchLesson {
  id: string;
  userId: string;
  kind: string;
}

export interface EntryMatchMatch {
  id: string;
  userId: string;
}

/** User-scoped storage boundary. Reads return null when RLS hides a row. */
export interface EntryMatchRepository {
  entry(id: string): Promise<EntryMatchEntry | null>;
  student(id: string): Promise<EntryMatchStudent | null>;
  lesson(id: string): Promise<EntryMatchLesson | null>;
  match(id: string): Promise<EntryMatchMatch | null>;
  updateLessonMatch(lessonId: string, matchId: string | null): Promise<boolean>;
}

export interface EntryMatchRequest {
  entryId: string;
  matchId: string | null;
}

export type EntryMatchResult = "saved" | "not_found" | "failed";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseEntryMatchRequest(body: unknown): EntryMatchRequest | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const entryId = typeof record.entryId === "string" ? record.entryId.trim() : "";
  if (!UUID_RE.test(entryId) || !("matchId" in record)) return null;
  if (record.matchId === null) return { entryId, matchId: null };
  const matchId = typeof record.matchId === "string" ? record.matchId.trim() : "";
  return UUID_RE.test(matchId) ? { entryId, matchId } : null;
}

/**
 * Link one coach entry to one match from that entry's roster student.
 *
 * The repository uses the signed-in Supabase client, so a row hidden by RLS
 * arrives as null. The explicit identity comparisons are a second boundary:
 * an accidentally broadened read still cannot cross coaches, lessons, or
 * students, and a visible review match for somebody else cannot be attached.
 */
export async function setCoachEntryMatch(
  data: EntryMatchRepository,
  userId: string,
  request: EntryMatchRequest,
): Promise<EntryMatchResult> {
  const entry = await data.entry(request.entryId);
  if (!entry || entry.id !== request.entryId || entry.coachId !== userId) {
    return "not_found";
  }

  const [student, lesson] = await Promise.all([
    data.student(entry.studentId),
    data.lesson(entry.lessonId),
  ]);
  if (
    !student ||
    student.id !== entry.studentId ||
    student.coachId !== userId ||
    !lesson ||
    lesson.id !== entry.lessonId ||
    lesson.userId !== userId ||
    lesson.kind !== "coach"
  ) {
    return "not_found";
  }

  if (request.matchId !== null) {
    const match = await data.match(request.matchId);
    if (
      !student.playerId ||
      !match ||
      match.id !== request.matchId ||
      match.userId !== student.playerId
    ) {
      return "not_found";
    }
  }

  return (await data.updateLessonMatch(entry.lessonId, request.matchId))
    ? "saved"
    : "failed";
}
