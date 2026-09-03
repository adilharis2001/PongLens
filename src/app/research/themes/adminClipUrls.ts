/**
 * Presigned links for this page, minted once and shared.
 *
 * Two kinds, and they are not interchangeable:
 *
 *   - the CUT video of a match, which the analysis view seeks into so the
 *     bounce rings can be drawn against the same clock the diagnosis uses;
 *   - one point's own CLIP, which the full-screen tape plays end to end.
 *
 * Both go through `/api/admin/media-url`, not `/api/media-url`. The public
 * one is gated on `has_match_access`, which is owner, linked coach or open
 * review order — an admin looking at somebody else's upload is none of the
 * three and would get a 403. The admin route's RPCs check `is_admin()`
 * instead, which is the whole reason this page can cross matches at all.
 *
 * Caching mirrors the starred page's: presigned for an hour, thrown away
 * at forty-five minutes so a link handed out at the boundary still has a
 * quarter of an hour on it, and in-flight requests are shared so a
 * read-ahead followed by a click costs one round trip.
 */

const FRESH_MS = 45 * 60 * 1000;

const cache = new Map<string, { url: string; at: number }>();
const pending = new Map<string, Promise<string | null>>();

async function mint(key: string, body: object): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.url;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const req = (async () => {
    try {
      const res = await fetch("/api/admin/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { url?: unknown };
      if (typeof data.url !== "string") return null;
      cache.set(key, { url: data.url, at: Date.now() });
      return data.url;
    } catch {
      return null;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, req);
  return req;
}

/** The match's cut video, which every card on that match seeks into. */
export function cutUrlFor(matchId: string): Promise<string | null> {
  return mint(`cut:${matchId}`, { matchId });
}

/** One point's own clip file.
 *
 *  `pointId` must travel WITH `matchId` and the route dispatches on it
 *  first, so this can never be confused with the cut above. */
export function clipUrlFor(
  matchId: string,
  pointId: string
): Promise<string | null> {
  return mint(`clip:${matchId}:${pointId}`, { matchId, pointId });
}

/** The bucket refused a signature: drop it so the next ask mints fresh. */
export function forgetClipUrl(matchId: string, pointId: string) {
  cache.delete(`clip:${matchId}:${pointId}`);
}
