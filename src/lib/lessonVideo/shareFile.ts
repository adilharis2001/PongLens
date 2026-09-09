/**
 * The downloadable copy of a recap, the one with the words painted into the
 * picture so they travel with the file.
 *
 * The apps play the clean video and draw the chapters themselves, so this
 * file is only ever used for a download. It is built when a coach asks for
 * it, and it goes out of date the moment they correct a word, because the
 * words are in the picture. Saying so is the whole job of this module: the
 * render row records the revision it was built from, and the lesson's
 * current revision says whether that is still the truth.
 */

export type ShareFileState = 'none' | 'queued' | 'processing' | 'ready' | 'behind' | 'failed';

export interface ShareRenderRow {
  status: string;
  revision: number;
  r2_key: string | null;
  bytes: number | null;
  stage: string | null;
  error: string | null;
}

/**
 * `revision` is the lesson's current one. A file built from an older
 * revision is not wrong, it is behind: it plays, it is downloadable, and it
 * shows the wording the coach had at the time.
 */
export function shareFileState(row: ShareRenderRow | null | undefined, revision: number): ShareFileState {
  if (!row) return 'none';
  if (row.status === 'queued') return 'queued';
  if (row.status === 'processing') return 'processing';
  if (row.status === 'failed') return 'failed';
  if (row.status === 'ready' && row.r2_key) return row.revision === revision ? 'ready' : 'behind';
  return 'none';
}

/** Whether a state has a file somebody can actually download. */
export function shareFileDownloadable(state: ShareFileState): boolean {
  return state === 'ready' || state === 'behind';
}

/** Whether asking for a build would do anything. */
export function shareFileCanPrepare(state: ShareFileState): boolean {
  return state !== 'queued' && state !== 'processing' && state !== 'ready';
}

/** "128 MB". Plain, and never printed when we do not know. */
export function shareFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

interface TimedChapter {
  start_s: number;
  end_s: number;
}

/**
 * Whether an incoming edit keeps the same clips in the same order.
 *
 * This is the line between an edit that is words and an edit that is video.
 * Retyping a cue changes nothing the encoder made, so it saves at once.
 * Removing a chapter changes the clean file every app plays, so it has to be
 * cut again. The clips are compared by their place in the original recording,
 * because that is what the render is made from; the summary clock is derived
 * from it and would say the same thing twice.
 */
export function sameChapterTiming(before: TimedChapter[], after: TimedChapter[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((chapter, index) =>
    chapter.start_s === after[index].start_s && chapter.end_s === after[index].end_s);
}

interface ClockChapter extends TimedChapter {
  summary_start_s?: number;
  summary_end_s?: number;
}

/**
 * Fill in where each chapter sits inside the finished recap.
 *
 * The worker derives this when it cuts the video, and until now nothing else
 * had to: every saved edit went straight back through the worker, which
 * rewrote it. A text-only edit does not, and `validateEdit` drops the two
 * fields, so without this a corrected recap would be stored without the clock
 * its own public page seeks by. The clips are unchanged on this path by
 * definition, so the arithmetic is the same one `normalize_edit` does.
 */
export function withSummaryClock<T extends ClockChapter>(chapters: T[]): T[] {
  let cursor = 0;
  return chapters.map((chapter) => {
    const start = cursor;
    cursor += Math.max(0, chapter.end_s - chapter.start_s);
    return { ...chapter, summary_start_s: round(start), summary_end_s: round(cursor) };
  });
}

const round = (n: number) => Math.round(n * 1000) / 1000;
