/** This identity owns the match's point state and every signed media URL. */
export function activeMatchVersionKey(matchId: string, versionId?: string | null): string {
  return `${matchId}:${versionId ?? "legacy"}`;
}

/** An older API with no version field is not evidence of a version change. */
export function shouldRefreshActiveVersion(current: string | null | undefined, fresh: string | null | undefined): boolean {
  return fresh !== undefined && (current ?? null) !== fresh;
}

/** A stale response must refresh the owning point snapshot before retrying. */
export async function activeCutPreview(matchId: string, expectedVersionId: string | null | undefined,
  request: typeof fetch = fetch, signal?: AbortSignal): Promise<{ url: string | null; stale: boolean }> {
  const response = await request("/api/media-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, preview: true, expectedVersionId }), signal,
  });
  const data = await response.json();
  return {
    url: response.ok && typeof data.url === "string" ? data.url : null,
    stale: response.status === 409 && data.code === "active_version_changed",
  };
}
