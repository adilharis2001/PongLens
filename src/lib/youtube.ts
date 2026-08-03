/** Mirrors the server-side check in /api/import-url (the server re-validates). */
export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The 11-character video id from any link shape the import accepts, or null.
 *
 * One function rather than two: "is this a YouTube link" and "which video is
 * it" were the same walk over the same URL shapes, and the moment they were
 * written separately they disagreed — the id version matched /embed/<id> on
 * ANY host, so a vimeo.com/embed/... link would have produced a YouTube
 * thumbnail. Validity is now defined as "we can name the video".
 */
export function youtubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    try {
      url = new URL(`https://${raw.trim()}`);
    } catch {
      return null;
    }
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? "";
  } else if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  ) {
    id =
      url.pathname === "/watch"
        ? (url.searchParams.get("v") ?? "")
        : (url.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/)?.[2] ?? "");
  }
  return YOUTUBE_VIDEO_ID.test(id) ? id : null;
}

/**
 * YouTube publishes a still for every video. It is the only frame available
 * before the worker has fetched the file, which is what lets the import form
 * ask which end you played from — a question that is a coin flip without a
 * picture. hqdefault always exists; maxres often 404s.
 */
export function youtubeThumbnail(raw: string): string | null {
  const id = youtubeVideoId(raw);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}
