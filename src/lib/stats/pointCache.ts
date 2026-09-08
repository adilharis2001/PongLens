"use client";

import type { Point } from "@/lib/types";

/**
 * The points of matches that have not changed, kept between visits.
 *
 * Every cross-match statistic is folded from every live point, through the
 * same pure walks the match page uses, so the numbers can never drift from
 * what a match page shows. That stays. What this removes is re-downloading
 * 2.5 MB to fold it again into the answer it gave last time.
 *
 * A match is cached under its fingerprint (`my_match_point_fingerprints`),
 * a digest of every column the walk reads. If the fingerprint still
 * matches, nothing the walk reads has changed, so last time's points are
 * still this time's points. That is why this cannot go stale in the way a
 * stored ANSWER can: the fingerprint is not a guess about freshness, it is
 * the question itself.
 *
 * IndexedDB rather than localStorage: this is megabytes, and localStorage
 * is both too small and synchronous. Every failure here is survivable —
 * a cache that will not open just means the walk fetches everything, which
 * is what it did before this existed.
 */

/**
 * Which matches can be answered from the cache, and which must be fetched.
 *
 * Pure, and tested, because it is the whole rule: get it too eager and a
 * scored match never updates; get it too shy and nothing is ever cached.
 * A match absent from `fingerprints` has no live points — that is a real
 * state, not a missing answer, so it fingerprints as the empty string and
 * caches like any other.
 */
export function splitByFreshness(
  ids: string[],
  fingerprints: Map<string, string>,
  cached: Map<string, { fingerprint: string; points: Point[] }>
): { fresh: [string, Point[]][]; stale: string[] } {
  const fresh: [string, Point[]][] = [];
  const stale: string[] = [];
  for (const id of ids) {
    const hit = cached.get(id);
    if (hit && hit.fingerprint === (fingerprints.get(id) ?? "")) {
      fresh.push([id, hit.points]);
    } else {
      stale.push(id);
    }
  }
  return { fresh, stale };
}

const DB_NAME = "ponglens-stats";
const DB_VERSION = 1;
const STORE = "matchPoints";

interface CachedMatch {
  /** `${userId}:${matchId}` — two people sharing a browser never mix. */
  key: string;
  fingerprint: string;
  points: Point[];
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // A blocked upgrade would otherwise hang the walk for ever.
    request.onblocked = () => resolve(null);
  });
}

const keyFor = (userId: string, matchId: string) => `${userId}:${matchId}`;

/**
 * What we already hold, as `matchId -> {fingerprint, points}`.
 *
 * Read in one transaction rather than one per match: a hundred round
 * trips through IndexedDB is its own kind of slow.
 */
export async function readCached(
  userId: string,
  matchIds: string[]
): Promise<Map<string, CachedMatch>> {
  const out = new Map<string, CachedMatch>();
  const db = await open();
  if (!db) return out;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const wanted = new Set(matchIds.map((id) => keyFor(userId, id)));
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return resolve();
        const row = c.value as CachedMatch;
        if (wanted.has(row.key)) {
          out.set(row.key.slice(userId.length + 1), row);
        }
        c.continue();
      };
      cursor.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // An unreadable cache is a cold cache.
  }
  db.close();
  return out;
}

/**
 * Save what was just fetched, and drop anything for a match that is no
 * longer in the library, so a deleted match does not sit here for ever.
 */
export async function writeCached(
  userId: string,
  fresh: { matchId: string; fingerprint: string; points: Point[] }[],
  liveMatchIds: string[]
): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const m of fresh) {
        store.put({
          key: keyFor(userId, m.matchId),
          fingerprint: m.fingerprint,
          points: m.points,
        } satisfies CachedMatch);
      }
      const live = new Set(liveMatchIds.map((id) => keyFor(userId, id)));
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        const row = c.value as CachedMatch;
        if (row.key.startsWith(`${userId}:`) && !live.has(row.key)) {
          c.delete();
        }
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Failing to save just means the next visit counts again.
  }
  db.close();
}
