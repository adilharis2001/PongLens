/**
 * Where the browser remembers an upload that has not finished yet, so it
 * can be resumed after a reload, a locked phone, or a closed tab.
 *
 * This used to be a single localStorage record, on the assumption that a
 * browser only ever has one upload going. Every tab shares one
 * localStorage, so two tabs meant two uploads fighting over one slot: a
 * second tab picking a different video aborted the first tab's multipart
 * upload outright, and a second tab picking the SAME video resumed into
 * it, leaving both racing to complete the one upload id. Whichever lost
 * got NoSuchUpload from R2 for as long as the user kept retrying.
 *
 * So: a list, one entry per upload, each stamped with the tab that owns it
 * and a heartbeat. A tab may pick up its own record, or one whose owner
 * has stopped beating and is therefore gone. It never touches an upload
 * another tab is still working on.
 */

export const PENDING_KEY = "ponglens:pending-uploads";
/** The single-record key this replaced; read once, then migrated away. */
export const LEGACY_PENDING_KEY = "ponglens:pending-upload";
export const PENDING_MAX_AGE = 6 * 24 * 3600 * 1000; // R2 aborts incomplete uploads at 7d
export const PENDING_EXPIRY_MS = 7 * 24 * 3600 * 1000; // when R2 itself gives up
/** Records kept at once. Older ones fall off; R2 sweeps the leftovers. */
export const MAX_PENDING = 5;
/**
 * How long a record stays "another tab is uploading this right now" after
 * its last heartbeat. The uploading tab beats every PENDING_BEAT_MS, so
 * this allows several misses before an upload counts as abandoned.
 */
export const PENDING_OWNER_TTL = 60 * 1000;
export const PENDING_BEAT_MS = 15 * 1000;
const TAB_KEY = "ponglens:tab-id";

export type PendingUpload<F = unknown> = {
  bucket: string;
  key: string;
  uploadId: string;
  name: string;
  size: number;
  contentType: string;
  startedAt: number;
  form: F;
  /**
   * A frame from the video, and how far it got. "Pick the same video" is a
   * memory test without them: iOS shows no file names in the Photos
   * picker, so the name on its own identifies nothing, and without a
   * figure there is no way to tell whether resuming saves ten minutes or
   * nothing at all.
   */
  poster?: string | null;
  bytesUploaded?: number;
  /** Which tab started this upload, and when it last said it was alive. */
  owner?: string;
  beatAt?: number;
};

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * This tab's identity, stable across reloads (sessionStorage) and distinct
 * from every other tab. It is what lets one tab tell its own unfinished
 * upload apart from another tab's.
 */
let fallbackTabId: string | null = null;
export function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = newId();
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    if (!fallbackTabId) fallbackTabId = newId();
    return fallbackTabId;
  }
}

function savePending(list: PendingUpload<unknown>[]) {
  try {
    if (list.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {}
}

/** Every remembered upload, newest first, with the expired ones dropped. */
export function readAllPending<F = unknown>(): PendingUpload<F>[] {
  let list: PendingUpload<F>[] = [];
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) list = parsed as PendingUpload<F>[];
  } catch {}
  // A record written before this became a list. Carry it over once so an
  // upload interrupted across the deploy is still resumable.
  let migrated = false;
  try {
    const legacy = localStorage.getItem(LEGACY_PENDING_KEY);
    if (legacy) {
      localStorage.removeItem(LEGACY_PENDING_KEY);
      const rec = JSON.parse(legacy) as PendingUpload<F>;
      if (rec?.key && !list.some((r) => r.key === rec.key)) {
        list = [...list, rec];
        migrated = true;
      }
    }
  } catch {}
  const fresh = list
    .filter(
      (r) =>
        r &&
        r.key &&
        r.uploadId &&
        r.size &&
        Date.now() - r.startedAt <= PENDING_MAX_AGE
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  // The migrated record has to be written back under the new key, and the
  // old key is already gone: counting lengths alone would drop it here and
  // lose the very upload the migration exists to keep.
  if (migrated || fresh.length !== list.length) savePending(fresh);
  return fresh;
}

/** True while some other tab is still working on this upload. */
export function heldElsewhere(rec: PendingUpload<unknown>): boolean {
  return (
    rec.owner != null &&
    rec.owner !== tabId() &&
    rec.beatAt != null &&
    Date.now() - rec.beatAt < PENDING_OWNER_TTL
  );
}

/**
 * The one upload this tab may pick up: its own before anyone else's, and
 * never one another tab is still uploading.
 */
export function readPending<F = unknown>(): PendingUpload<F> | null {
  const list = readAllPending<F>();
  return (
    list.find((r) => r.owner === tabId()) ??
    list.find((r) => !heldElsewhere(r)) ??
    null
  );
}

export function writePending<F>(rec: PendingUpload<F>) {
  const rest = readAllPending<F>().filter((r) => r.key !== rec.key);
  const next = [
    { ...rec, owner: rec.owner ?? tabId(), beatAt: Date.now() },
    ...rest,
  ];
  savePending(next.slice(0, MAX_PENDING));
}

/** Update one record in place, by key. A record already gone stays gone. */
export function updatePending<F>(
  key: string | undefined,
  patch: Partial<PendingUpload<F>>
) {
  if (!key) return;
  const rec = readAllPending<F>().find((r) => r.key === key);
  if (rec) writePending({ ...rec, ...patch });
}

export function clearPending(key: string | undefined) {
  if (!key) return;
  savePending(readAllPending().filter((r) => r.key !== key));
}
