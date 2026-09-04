import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { coachRefUpdate } from "@/lib/journal/coachRef";
import { entryImageEdit } from "@/lib/journal/entryImage";
import { releaseEntryImage } from "@/lib/journal/releaseEntryImage";
import type { LessonTakeaways } from "@/lib/types";

export const runtime = "nodejs";

/**
 * PATCH /api/lesson/note — edit the notes an entry was distilled into.
 *
 *   { lessonId, takeaways, coachName? } -> { id, takeaways }
 *
 * Fixing one wrong bullet used to mean re-editing the speech-to-text of a
 * forty-minute lesson and regenerating all sixteen points from it. Nobody
 * did that, so wrong points stood forever. This edits the notes directly.
 *
 * It writes takeaways, coach_name when a name is sent, and the attached
 * photo when the edit mentions one — the photo belongs to the entry, not
 * to the words, so both editors can change it and a photo that stops
 * being attached is dropped from storage. Nothing else. The transcript is
 * the record of what was actually said, so it is never touched here; kind and status are settled when the entry is saved
 * and are not the note's business. Nothing is re-distilled and Recollect
 * is not re-enqueued, for the same reason in both cases: those derive from
 * the transcript, and the transcript did not change.
 *
 * The two editors partition the entries between them instead of
 * overlapping. An entry with notes is edited here, and its words are
 * read-only. An entry without them has only its words, which are its note,
 * and PATCH /api/lesson edits those. Each route refuses the other's rows.
 */

/**
 * What a hand-written note is allowed to be.
 *
 * These are not guesses about how people write. They are the point past
 * which a note has stopped being a note and a mistake, or a script, is
 * filling the row instead. Anything over a limit is cut rather than
 * refused, so an over-long paste still saves as something.
 */
const MAX_TITLE = 120;
const MAX_THEMES = 12;
const MAX_THEME_NAME = 80;
const MAX_POINTS_PER_THEME = 20;
const MAX_POINT = 400;
/** The column's own check constraint caps the coach's name at 80 (085). */
const MAX_COACH_NAME = 80;

/**
 * A note filled to every limit above is roughly 100KB of JSON, so a body
 * past this ceiling is not a note. Reading the declared length first means
 * a huge post costs nothing to turn away; a client that lies about it just
 * meets the trimming below instead, which is the real bound on what gets
 * stored.
 */
const MAX_BODY_BYTES = 256_000;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A whole emoji, or half of one with the other half missing.
 *
 * The complete pair is matched first so that it wins the alternation and
 * survives; whatever the second branch catches is a surrogate on its own,
 * which is what has to go.
 */
const SURROGATE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

/**
 * Clean one typed line and cut it to a length.
 *
 * Three of the things this removes are ways Postgres refuses to store the
 * row: a null byte, which jsonb cannot hold as text at all; a surrogate
 * that lost its pair; and a cut that lands in the middle of an emoji,
 * which creates the second of those. All three turn an ordinary save into
 * a 500, and the last one needs nothing stranger than an emoji sitting at
 * character four hundred. Cutting by code point keeps the emoji whole.
 *
 * Runs of whitespace collapse because every field here is one line: a
 * bullet, a section name, a title. A paragraph pasted into one of them
 * becomes a long line rather than something that breaks the layout.
 */
function line(value: unknown, max: number): string {
  // Anything that is not text is dropped rather than converted. String({})
  // is "[object Object]" and String(null) is "null", and a bullet reading
  // either of those is worse than a bullet that never arrived. A finite
  // number is the one exception, because it converts to exactly itself.
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";
  const cleaned = text
    .replace(SURROGATE, (match) => (match.length === 2 ? match : ""))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(cleaned);
  if (chars.length <= max) return cleaned;
  return chars.slice(0, max).join("").trim();
}

type NoteResult =
  | { ok: true; takeaways: LessonTakeaways }
  | { ok: false; error: string };

/**
 * Turn whatever a client posted into storable takeaways.
 *
 * This is deliberately a separate reader from parseTakeaways in
 * ../route.ts. That one reads untrusted model output and only has to
 * decide whether the model answered at all; this one reads untrusted user
 * input, has to bound every field, and has to be able to say what is wrong
 * in a sentence the writer can act on. Forcing them into one function
 * would make both harder to follow than keeping the twin.
 */
function normaliseNote(raw: unknown, fallbackTitle: string): NoteResult {
  const source = raw as { title?: unknown; themes?: unknown } | null;
  const incoming = Array.isArray(source?.themes) ? source.themes : [];

  const themes: LessonTakeaways["themes"] = [];
  for (const entry of incoming) {
    const section = entry as { name?: unknown; points?: unknown } | null;
    const name = line(section?.name, MAX_THEME_NAME);

    const points: string[] = [];
    const seen = new Set<string>();
    if (Array.isArray(section?.points)) {
      for (const candidate of section.points) {
        const point = line(candidate, MAX_POINT);
        // The same bullet twice in one section says nothing twice, and the
        // entry list keys its bullets on their text, so a repeat makes one
        // of the two behave like the other.
        if (!point || seen.has(point)) continue;
        seen.add(point);
        points.push(point);
        if (points.length === MAX_POINTS_PER_THEME) break;
      }
    }
    // A section with nothing in it is one the writer opened and left. It
    // is dropped before the name is looked at, so an empty new section
    // never turns into an error about naming it.
    if (points.length === 0) continue;
    if (!name) {
      return { ok: false, error: "Every heading needs a name." };
    }

    const existing = themes.find((theme) => theme.name === name);
    if (existing) {
      // Two sections with the same name are one section to whoever reads
      // the entry, and the entry list keys its headings on the name, so
      // keeping both makes the second one disappear at random. Merging
      // loses nothing; dropping it would lose the writer's points.
      for (const point of points) {
        if (existing.points.length === MAX_POINTS_PER_THEME) break;
        if (!existing.points.includes(point)) existing.points.push(point);
      }
      continue;
    }
    if (themes.length === MAX_THEMES) break;
    themes.push({ name, points });
  }

  if (themes.length === 0) {
    return { ok: false, error: "Add at least one point before saving." };
  }
  return {
    ok: true,
    takeaways: {
      title: line(source?.title, MAX_TITLE) || fallbackTitle,
      themes,
    },
  };
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "That note is too long to save." },
      { status: 413 },
    );
  }

  let body: {
    lessonId?: unknown;
    takeaways?: unknown;
    coachName?: unknown;
    coachRefId?: unknown;
    shareWithCoach?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Valid JSON is not necessarily an object: a bare string or null parses
  // fine and then every read off it is a different kind of crash.
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const lessonId = String(body.lessonId ?? "").trim();
  // An id that is not a uuid cannot match a row, and asking Postgres about
  // it raises a type error rather than returning nothing.
  if (!UUID.test(lessonId)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // RLS answers "is this yours": a row the caller cannot read is a 404,
  // never a hint that it exists.
  const { data: row } = await supabase
    .from("lessons")
    .select("id, kind, takeaways, image_path, coach_ref_id, shared_with_coach_at")
    .eq("id", lessonId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existing = row.takeaways as LessonTakeaways | null;
  if (!existing) {
    // Nothing was distilled from this entry, so its words are its note and
    // PATCH /api/lesson is where they are edited. Writing notes onto it
    // here would also take its words editor away, since that route refuses
    // an entry that has notes.
    return NextResponse.json(
      { error: "This entry doesn't have notes to edit." },
      { status: 409 },
    );
  }

  const result = normaliseNote(
    body.takeaways,
    line(existing.title, MAX_TITLE) || "Lesson",
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const photo = entryImageEdit(body as Record<string, unknown>, user.id);
  if (photo.kind === "invalid") {
    return NextResponse.json({ error: "Invalid image" }, { status: 400 });
  }

  const update: {
    takeaways: LessonTakeaways;
    coach_name?: string | null;
    coach_ref_id?: string | null;
    shared_with_coach_at?: string | null;
    image_path?: string | null;
  } = {
    takeaways: result.takeaways,
  };
  if (photo.kind === "set") update.image_path = photo.imagePath;
  // Who taught it (085). Only a lesson has one, so a practice entry
  // ignores the field rather than growing a coach. An absent field means
  // leave the name alone; an empty one means clear it.
  if (row.kind === "lesson" && "coachName" in body) {
    update.coach_name = line(body.coachName, MAX_COACH_NAME) || null;
  }
  // Which coach, as a row (164), and whether they may read it. Same
  // absent-means-leave-it rule as the name above, so a caller that has
  // never heard of coaches cannot clear an attribution by omission —
  // which is exactly what the iOS app does until it ships this.
  //
  // Whose row it is stays the database's question: lessons_coach_normalise
  // refuses one that is not the author's own, for every writer at once.
  if (row.kind === "lesson" && "coachRefId" in body) {
    Object.assign(
      update,
      coachRefUpdate({
        coachRefId: body.coachRefId,
        shareWithCoach: body.shareWithCoach,
        currentRefId: row.coach_ref_id as string | null,
        currentSharedAt: row.shared_with_coach_at as string | null,
      }),
    );
  }

  // The row is read back on the way out. An update that matches nothing
  // reports no error, it just changes nothing, so an expired session reads
  // exactly like a successful save; the read is what makes that visible.
  const { data: saved, error: updateError } = await supabase
    .from("lessons")
    .update(update)
    .eq("id", lessonId)
    .select("id, takeaways")
    .single();
  if (updateError || !saved) {
    console.error("lesson note edit error:", updateError);
    return NextResponse.json(
      { error: "Couldn't save it. Try again." },
      { status: 500 },
    );
  }

  // The photo the entry used to carry, now that the row has stopped
  // pointing at it. After the write, so a failed save never strands the
  // entry pointing at an object that is already gone.
  if (photo.kind === "set" && photo.imagePath !== row.image_path) {
    await releaseEntryImage(supabase, row.image_path, user.id);
  }

  return NextResponse.json({ id: saved.id, takeaways: saved.takeaways });
}
