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

export interface EntryMatchFetchResponse {
  ok: boolean;
}

export type EntryMatchFetch = (
  input: string,
  init?: RequestInit,
) => Promise<EntryMatchFetchResponse>;

export type CreatedEntryMatchResult =
  | "linked"
  | "rolled_back"
  | "saved_unlinked";

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

/** A request failure is a normal unsuccessful save, never an escaped promise. */
export async function persistEntryMatch(
  request: EntryMatchFetch,
  entryId: string,
  matchId: string | null,
): Promise<boolean> {
  try {
    const response = await request("/api/coaching/entry-match", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId, matchId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Finish a newly-created entry's requested match link atomically from the
 * composer's point of view. A failed link removes the whole new lesson. If
 * that removal cannot be confirmed, the caller must reconcile the surviving
 * entry instead of leaving the composer open to create a duplicate.
 */
export async function finalizeCreatedEntryMatch(
  request: EntryMatchFetch,
  input: { entryId: string; lessonId: string; matchId: string },
): Promise<CreatedEntryMatchResult> {
  if (await persistEntryMatch(request, input.entryId, input.matchId)) {
    return "linked";
  }
  try {
    const response = await request("/api/journal-entry", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId: input.lessonId }),
    });
    return response.ok ? "rolled_back" : "saved_unlinked";
  } catch {
    return "saved_unlinked";
  }
}

/** A confirmed lesson rollback also deleted its owned R2 image. Clear that
 * local path before retry while leaving the coach's draft words untouched. */
export function recoverConfirmedEntryMatchRollback(
  input: { hasUploadedPhoto: boolean },
  effects: { clearPhoto(): void; setError(message: string): void },
): void {
  if (input.hasUploadedPhoto) {
    effects.clearPhoto();
    effects.setError(
      "The match couldn't be linked. Your words are still here — reattach the photo before trying again.",
    );
    return;
  }
  effects.setError(
    "The match couldn't be linked. Your words are still here — try again.",
  );
}

/** Turn an uncertain rollback into one explicit reconciliation path. The
 * caller's callback reloads the real journal and retires the composer, so a
 * surviving entry cannot be duplicated by retrying the same draft. */
export async function completeCreatedEntryMatch(
  request: EntryMatchFetch,
  input: { entryId: string; lessonId: string; matchId: string },
  reconcileSavedEntry: () => Promise<void>,
): Promise<"linked" | "rolled_back" | "reconciled"> {
  const result = await finalizeCreatedEntryMatch(request, input);
  if (result !== "saved_unlinked") return result;
  await reconcileSavedEntry();
  return "reconciled";
}

/** Drive the existing-entry UI through success or failure and always retire
 * its busy state, including when the browser rejects the request itself. */
export async function updateExistingEntryMatch(
  request: EntryMatchFetch,
  input: { entryId: string; matchId: string | null },
  effects: {
    setBusy(entryId: string | null): void;
    onSaved(matchId: string | null): void;
    onFailed(): void;
  },
): Promise<void> {
  effects.setBusy(input.entryId);
  try {
    if (await persistEntryMatch(request, input.entryId, input.matchId)) {
      effects.onSaved(input.matchId);
    } else {
      effects.onFailed();
    }
  } finally {
    effects.setBusy(null);
  }
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
