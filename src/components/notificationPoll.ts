/**
 * When the bell may ask the server, and how often.
 *
 * Two things went wrong here and both were invisible, because the bell
 * discarded failures and showed an empty badge either way.
 *
 * 1. It asked while signed out. `notifications` is a per-viewer table and
 *    `anon` holds no read permission on it at all, so a poll from a tab
 *    whose session had gone was REFUSED rather than answered with an empty
 *    list. Nothing noticed, and the timer kept running: a single stale tab
 *    produced a permission error every 60s for as long as it stayed open.
 *    On 4 Sep 2026 that was 13,200 database errors in a day, 98.7% of all
 *    of them.
 * 2. It asked twice. AppNav builds the desktop header and the mobile
 *    header at the same time and hides one with CSS, so the bell mounts
 *    TWICE on every page. Hiding an element does not stop it running, so
 *    each page held two timers for one badge, and two copies of the read
 *    state that could disagree.
 *
 * So the rule is: one poll for however many bells are on the page, and no
 * request at all without a session. The port below is the only part that
 * knows about Supabase, which is what lets this be tested without a
 * browser or a network.
 */

/** The little a poll needs to know about a row to keep read state. */
export type PolledNotification = { id: string; read_at: string | null };

export type PollPort<T extends PolledNotification> = {
  /** Whether there is a session to read with. Must not throw. */
  hasSession: () => Promise<boolean>;
  /** The rows, or null when the read failed or was refused. */
  fetch: () => Promise<T[] | null>;
  /**
   * Signed-in state changes. Called with false on sign-out and true on
   * sign-in. Returns its own unsubscribe.
   */
  watchAuth: (onChange: (signedIn: boolean) => void) => () => void;
};

export type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export const POLL_MS = 60_000;

export type NotificationPoll<T extends PolledNotification> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T[] | null;
  getServerSnapshot: () => T[] | null;
  /** Ask now, if there is a session. */
  refresh: () => Promise<void>;
  /** Optimistic read state, applied to the shared rows. */
  applyRead: (ids: string[], stamp: string) => void;
  /** Test seam: how many timers are running (0 or 1). */
  timerCount: () => number;
};

export function createNotificationPoll<T extends PolledNotification>(
  port: PollPort<T>,
  opts: { intervalMs?: number; timers?: Timers } = {}
): NotificationPoll<T> {
  const intervalMs = opts.intervalMs ?? POLL_MS;
  const timers: Timers = opts.timers ?? {
    set: (fn, ms) => setInterval(fn, ms),
    clear: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };

  let snapshot: T[] | null = null;
  const listeners = new Set<() => void>();
  let handle: unknown = null;
  let stopAuth: (() => void) | null = null;

  function emit(next: T[] | null) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function refresh() {
    // The whole fix: ask whether we may before we ask for anything.
    if (!(await port.hasSession())) {
      // An empty bell rather than a stale one, but no request either way.
      if (snapshot === null || snapshot.length > 0) emit([]);
      return;
    }
    const rows = await port.fetch();
    if (rows) emit(rows);
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    // Only the FIRST bell starts anything. The second one just watches.
    if (listeners.size === 1) {
      void refresh();
      handle = timers.set(() => void refresh(), intervalMs);
      stopAuth = port.watchAuth((signedIn) => {
        if (signedIn) void refresh();
        else emit([]);
      });
    }
    return () => {
      listeners.delete(listener);
      // ...and only the LAST one stops it.
      if (listeners.size > 0) return;
      if (handle !== null) timers.clear(handle);
      handle = null;
      stopAuth?.();
      stopAuth = null;
    };
  }

  return {
    subscribe,
    getSnapshot: () => snapshot,
    // Nothing is known until the client has asked, on the server and on
    // the first client render alike, so hydration matches.
    getServerSnapshot: () => null,
    refresh,
    applyRead(ids, stamp) {
      emit(
        (snapshot ?? []).map((n) =>
          ids.includes(n.id) && !n.read_at ? { ...n, read_at: stamp } : n
        )
      );
    },
    timerCount: () => (handle === null ? 0 : 1),
  };
}
