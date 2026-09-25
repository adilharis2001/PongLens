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

/**
 * Is this job the one behind a match the page already shows?
 *
 * Two links, because either can be the only one. Commerce mode writes the
 * match first and the worker links `matches.job_id` later, so a queued job
 * is found by its own `options.match_id`. And once a match is cut again
 * and the new cut goes live, `matches.job_id` moves to the new job, so the
 * original upload's job is linked by nothing BUT its `match_id`. Reading
 * `job_id` alone put that original on Home as a stray "Processed videos"
 * card beside the match it made.
 */
export function jobBehindMatch(
  job: { id: string; options?: { match_id?: string | null } | null },
  matchJobIds: ReadonlySet<string | null>,
  matchIds: ReadonlySet<string>,
): boolean {
  return matchJobIds.has(job.id) || matchIds.has(String(job.options?.match_id ?? ""));
}
