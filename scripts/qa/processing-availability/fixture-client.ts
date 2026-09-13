// Test transport only. Bundled by serve.mjs, never imported by the application.
export const owner = "11111111-1111-4111-8111-111111111111";
export const matchId = "22222222-2222-4222-8222-222222222222";
export const jobId = "33333333-3333-4333-8333-333333333333";
export const fixture = { main: "unavailable", fast: "available", hand: "available", kind: "deadspace_cut", jobStatus: "queued", matchStatus: "processing" };
export const match = () => ({ id: matchId, user_id: owner, job_id: jobId, opponent_name: "Practice match", venue: "Club", status: fixture.matchStatus, raw_path: "r2://ponglens-raw/fixture", duration_s: 1500, created_at: "2026-09-13T00:00:00Z", played_at: "2026-09-13", points: [{ count: 0 }], first_server: "user", user_side: "near" });
export const job = () => ({ id: jobId, user_id: owner, kind: fixture.kind, status: fixture.jobStatus, progress: 18, options: { match_id: matchId, points: true }, original_name: "practice.mp4", user_message: null, created_at: "2026-09-13T00:00:00Z" });
export function createClient() {
  function query(data: unknown) {
    const builder: Record<string, unknown> = {};
    for (const key of ["select", "eq", "neq", "in", "is", "not", "order", "limit", "range", "abortSignal"]) builder[key] = () => builder;
    builder.maybeSingle = builder.single = () => Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error: null });
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return builder;
  }
  return {
    from: (table: string) => query(table === "matches" ? [match()] : table === "jobs" ? [job()] : []),
    rpc: (name: string) => query(name === "processing_service_status" ? { ...fixture, clip_lane: "fast", observed_at: new Date().toISOString() }
      : name === "my_match_processing_feedback" ? [{ match_id: matchId, job_id: jobId, job_kind: fixture.kind, job_status: fixture.jobStatus, worker_state: "missing", lane: fixture.kind === "hand_cut" ? "hand" : "main", service_state: fixture.kind === "hand_cut" ? fixture.hand : fixture.main, stage: "ball", camera_check: null }]
        : []),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: { id: owner } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  };
}
