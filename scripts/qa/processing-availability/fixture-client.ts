// Test transport only. Bundled by serve.mjs, never imported by the application.
export const owner = "11111111-1111-4111-8111-111111111111";
export const matchId = "22222222-2222-4222-8222-222222222222";
export const jobId = "33333333-3333-4333-8333-333333333333";
export const fixture = { main: "unavailable", fast: "available", hand: "available", kind: "deadspace_cut", jobStatus: "queued", matchStatus: "processing", estimate: "range" };
export function estimate() {
  const now = Date.now();
  return { state: fixture.estimate, observed_at: new Date(now).toISOString(), expires_at: new Date(now + (fixture.estimate === "stale" ? -1000 : 90000)).toISOString(), ready_earliest_at: new Date(now + 20 * 60000).toISOString(), ready_latest_at: new Date(now + 45 * 60000).toISOString(), start_earliest_at: new Date(now + 5 * 60000).toISOString(), start_latest_at: new Date(now + 15 * 60000).toISOString(), reason: "metadata_unknown", basis: "recent_baseline_20260913" };
}
function overview() {
  const now = new Date().toISOString();
  return { now, workers: ["main", "fast", "hand"].map((lane) => ({ worker_id: `mac:${lane}`, lane, host: "Mac Studio", started_at: now, beat_at: fixture[lane as "main"] === "unavailable" ? "2026-09-01T00:00:00Z" : now, stage: fixture[lane as "main"] === "maintenance" ? "drained" : null, job_id: null })), lesson: {}, waiting: [{ ...job(), match_id: matchId, player: "Player" }], running: [], recent: [], day: {}, queue: [{ queue_name: "jobs", queue_length: 1, oldest_msg_age_sec: 60 }], reclip_lane: "fast", cloud: { cloud_mode: "disabled" } };
}
export const match = () => ({ id: matchId, user_id: owner, job_id: jobId, opponent_name: "Practice match", venue: "Club", status: fixture.matchStatus, raw_path: "r2://ponglens-raw/fixture", duration_s: 1500, created_at: "2026-09-13T00:00:00Z", played_at: "2026-09-13", points: [{ count: 0 }], first_server: "user", user_side: "near" });
export const job = () => ({ id: jobId, user_id: owner, kind: fixture.kind, status: fixture.jobStatus, progress: 18, options: { match_id: matchId, points: true }, original_name: "practice.mp4", user_message: null, created_at: "2026-09-13T00:00:00Z" });
export function createClient() {
  function query(data: unknown) {
    const builder: Record<string, unknown> = {};
    for (const key of ["select", "eq", "neq", "in", "is", "not", "or", "gt", "gte", "lt", "order", "limit", "range", "abortSignal"]) builder[key] = () => builder;
    builder.maybeSingle = builder.single = () => Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error: null });
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return builder;
  }
  return {
    from: (table: string) => query(table === "matches" ? [match()] : table === "jobs" ? [job()] : []),
    rpc: (name: string) => query(name === "processing_service_status" ? { ...fixture, clip_lane: "fast", observed_at: new Date().toISOString() }
      : name === "my_match_processing_feedback" ? [{ match_id: matchId, job_id: jobId, job_kind: fixture.kind, job_status: fixture.jobStatus, worker_state: "missing", lane: fixture.kind === "hand_cut" ? "hand" : "main", service_state: fixture.kind === "hand_cut" ? fixture.hand : fixture.main, stage: "ball", camera_check: null, estimate: estimate() }]
        : name === "my_processing_estimates" || name === "admin_processing_estimates" ? [{ job_id: jobId, estimate: estimate() }]
        : name === "admin_processing_overview" ? overview()
        : name === "admin_processing_health" ? { as_of: new Date().toISOString(), control: { expected_after: null, monitor_at: null }, incidents: [], missing: [], runs: [] }
        : []),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: { id: owner } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  };
}
