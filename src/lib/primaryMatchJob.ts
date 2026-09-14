/** Keep match processing and gate failures visible ahead of derived jobs. */
export function selectPrimaryMatchJob<T extends { kind: string | null; status: string; created_at?: string }>(jobs: T[]): T | null {
  const primary = new Set(["deadspace_cut", "youtube_import", "hand_cut"]);
  const rank = (job: T) => primary.has(job.kind ?? "")
    ? (["queued", "processing"].includes(job.status) ? 0 : 1)
    : 2;
  const timestamp = (job: T) => {
    const value = Date.parse(job.created_at ?? "");
    return Number.isFinite(value) ? value : 0;
  };
  return jobs.filter((job) => primary.has(job.kind ?? "") || job.kind === "content_check")
    .sort((a, b) => rank(a) - rank(b) || timestamp(b) - timestamp(a))[0] ?? null;
}
