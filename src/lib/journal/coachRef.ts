/**
 * Which coach a journal entry belongs to, and whether they may read it
 * (164). One function, because three routes write it — POST /api/lesson,
 * PATCH /api/lesson and PATCH /api/lesson/note — and a rule written three
 * times is a rule with three behaviours.
 *
 * Whose coach row it is stays the database's question.
 * lessons_coach_normalise refuses a row that is not the author's own, and
 * refuses it for iOS and every future writer at the same time. Repeating
 * that check here would be a second copy that could disagree with the one
 * that actually holds.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CoachRefWrite {
  coach_ref_id: string | null;
  shared_with_coach_at: string | null;
}

export function coachRefUpdate(input: {
  /** Raw from the request body. Anything that is not a uuid is "no coach". */
  coachRefId: unknown;
  /** Strictly true to share. An absent or truthy-ish value is not consent. */
  shareWithCoach: unknown;
  /** What the row says now, so an edit does not re-date an old share. */
  currentRefId?: string | null;
  currentSharedAt?: string | null;
  now?: () => string;
}): CoachRefWrite {
  const raw = String(input.coachRefId ?? "").trim();
  const id = UUID_RE.test(raw) ? raw : null;

  // No coach means no grant. The database enforces this too; saying it
  // here keeps the written row honest rather than relying on a repair.
  if (!id) return { coach_ref_id: null, shared_with_coach_at: null };

  if (input.shareWithCoach !== true) {
    return { coach_ref_id: id, shared_with_coach_at: null };
  }

  // Editing an entry that is already shared with this same coach keeps the
  // date it was shared. Stamping a fresh one would bounce the entry back
  // to the top of the coach's list every time a typo was fixed, and the
  // column would stop meaning "when they got it".
  const unchanged = input.currentRefId === id && !!input.currentSharedAt;
  const at = unchanged
    ? (input.currentSharedAt as string)
    : (input.now ?? (() => new Date().toISOString()))();
  return { coach_ref_id: id, shared_with_coach_at: at };
}
