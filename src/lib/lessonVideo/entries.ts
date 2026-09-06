/**
 * What a journal entry with a lesson video behind it needs from its
 * renderers, worked out once for web and mirrored on iOS.
 *
 * Sharing a recap writes an ordinary coach entry (publish_lesson_video)
 * whose text is a link to the recap, once in the transcript and once as a
 * takeaway, because the older app versions on phones can only show text.
 * A renderer that knows better shows the recap itself and hides both.
 */

export const LESSON_VIDEO_THEME = 'Lesson video';

const NOTE = /https?:\/\/(?:www\.)?ponglens\.com\/lesson-video\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * The recap behind an entry, if any. The column is the answer; the link in
 * the text is the fallback for a row read before the column existed.
 */
export function recapIdOf(entry: { lesson_video_id?: string | null; transcript?: string | null }): string | null {
  if (entry.lesson_video_id) return entry.lesson_video_id;
  const match = NOTE.exec(entry.transcript ?? '');
  return match ? match[1].toLowerCase() : null;
}

/** The takeaways to show: for a recap, without the link the older apps need. */
export function entryThemes<T extends { name: string; points: string[] }>(
  themes: T[] | null | undefined,
  recap: boolean,
): T[] {
  const list = themes ?? [];
  if (!recap) return list;
  return list.filter((theme) => !(theme.name === LESSON_VIDEO_THEME && theme.points.every((point) => NOTE.test(point))));
}

/** Where a recap opens. */
export function recapHref(id: string): string {
  return `/lesson-video/${id}`;
}
