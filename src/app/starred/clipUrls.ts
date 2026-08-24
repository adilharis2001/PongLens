/**
 * Presigned clip URLs, minted once and shared by every surface on the
 * Starred page.
 *
 * Two callers want the same link for different reasons: a tile that is
 * being hovered, and the sequence player that reads one clip ahead. Both
 * go through here so a hover followed by a click costs one round trip
 * rather than two, and so a clip already seen replays instantly.
 *
 * The links are presigned for an hour (r2.ts presignGet). Forty-five
 * minutes is the point at which a cached one is thrown away — early
 * enough that a link handed out at the boundary still has a quarter of
 * an hour of life in it, which is longer than any rally.
 */

const FRESH_MS = 45 * 60 * 1000;

const cache = new Map<string, { url: string; at: number }>();
/** In-flight requests, so a hover and a click never mint twice. */
const pending = new Map<string, Promise<string | null>>();

function key(matchId: string, pointId: string) {
  return `${matchId}:${pointId}`;
}

export async function clipUrlFor(
  matchId: string,
  pointId: string
): Promise<string | null> {
  const k = key(matchId, pointId);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.url;
  const inFlight = pending.get(k);
  if (inFlight) return inFlight;

  const req = (async () => {
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId, pointId }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data?.url !== "string") return null;
      cache.set(k, { url: data.url, at: Date.now() });
      return data.url as string;
    } catch {
      return null;
    } finally {
      pending.delete(k);
    }
  })();
  pending.set(k, req);
  return req;
}

/** The clip 404'd or the signature was refused: ask for a fresh one next time. */
export function forgetClipUrl(matchId: string, pointId: string) {
  cache.delete(key(matchId, pointId));
}
