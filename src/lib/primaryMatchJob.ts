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

/**
 * Matches whose latest primary job is a hand cut that failed for good.
 *
 * A terminal hand-cut failure hands the marks back and puts the match row
 * back as it was: status 'uploaded', job_id null. Nothing on the row says
 * anything went wrong, so read by its status alone the match looks like an
 * untouched upload. The job is the only record, and this is how Home and
 * the library find it. Pass whatever jobs the page holds: with only hand
 * cuts in the list, the latest hand cut stands for the latest primary job.
 */
export function failedHandCutMatchIds(
  jobs: readonly { kind: string | null; status: string; created_at?: string; options?: { match_id?: string | null } | null }[] | null | undefined,
): Set<string> {
  const primary = new Set(["deadspace_cut", "youtube_import", "hand_cut"]);
  const latest = new Map<string, { kind: string | null; status: string; at: number }>();
  for (const job of jobs ?? []) {
    const matchId = job.options?.match_id;
    if (!matchId || !primary.has(job.kind ?? "")) continue;
    const parsed = Date.parse(job.created_at ?? "");
    const at = Number.isFinite(parsed) ? parsed : 0;
    const seen = latest.get(matchId);
    if (!seen || at > seen.at) latest.set(matchId, { kind: job.kind, status: job.status, at });
  }
  const failed = new Set<string>();
  for (const [matchId, job] of latest) {
    if (job.kind === "hand_cut" && job.status === "failed") failed.add(matchId);
  }
  return failed;
}

/**
 * The status a match card shows: a match back at 'uploaded' after its hand
 * cut failed reads as failed, exactly like an automatic failure, unless a
 * job is already working on it again.
 */
export function matchDisplayStatus<S extends string>(
  status: S,
  hasLiveJob: boolean,
  handCutFailed: boolean,
): S | "failed" {
  return status === "uploaded" && !hasLiveJob && handCutFailed ? "failed" : status;
}
