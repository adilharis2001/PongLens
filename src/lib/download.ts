/**
 * Start a download without leaving the page.
 *
 * Our media links are signed with attachment disposition (see
 * /api/media-url), which is most of the work — but pointing the browser at
 * an .mp4 with `location.href` still reads as navigation, and a phone will
 * happily open the video full-screen instead of saving it. An anchor
 * carrying `download` is the part that says "this is a file, not a page".
 *
 * No blob: the file is a whole rendered match, and fetching it into memory
 * to re-serve it costs a second copy of the video for nothing.
 */
export function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  // Empty on purpose: the real filename rides on the URL's
  // Content-Disposition, which the signer sets.
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Ask for a signed export link and save it. Throws if the link is refused. */
export async function downloadReel(matchId: string, scope: string) {
  const res = await fetch("/api/media-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, reel: true, scope }),
  });
  const data = res.ok ? await res.json() : null;
  if (!data?.url) throw new Error("no url");
  triggerDownload(data.url);
}
