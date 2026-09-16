import type { ProcessingOverview, WorkerPulse } from "@/app/admin/processing/processingView";

/**
 * Fixture documents for the dev-only preview route. Every number here is
 * invented so the page's states can be looked at without a live worker
 * in each of them; nothing is read from the database.
 */

const RELEASE = "62295e48b91091b93ef796d2cf8688482d524af3df863f757b170f437d00fea1";

function ago(now: Date, s: number): string {
  return new Date(now.getTime() - s * 1000).toISOString();
}

function pulse(now: Date, over: Partial<WorkerPulse>): WorkerPulse {
  return {
    worker_id: "mac:main",
    lane: "main",
    host: "mac",
    pid: 11072,
    code_version: `release ${RELEASE}`,
    started_at: ago(now, 26 * 3600),
    beat_at: ago(now, 6),
    job_id: null,
    job_kind: null,
    match_id: null,
    stage: null,
    stage_note: null,
    stage_pct: null,
    host_load_1m: 9.2,
    host_cpu_count: 20,
    player: null,
    job_created_at: null,
    ...over,
  };
}

export type PreviewScene = "standby" | "running" | "off" | "starting";

export function previewOverview(scene: string, now = new Date()): ProcessingOverview {
  const macAlive = scene !== "running" && scene !== "starting";
  const macBeat = macAlive ? 6 : 22 * 60;
  const workers: WorkerPulse[] = [
    pulse(now, {
      beat_at: ago(now, macBeat),
      job_id: macAlive ? "job-mac-1" : null,
      job_kind: macAlive ? "deadspace_cut" : null,
      match_id: macAlive ? "40e21600-4430-4dc5-9af2-65bf24e2679e" : null,
      stage: macAlive ? "players" : null,
      stage_note: macAlive ? "widened crop, 38% of the video" : null,
      stage_pct: macAlive ? 38 : null,
      player: macAlive ? "Julian" : null,
      job_created_at: macAlive ? ago(now, 41 * 60) : null,
    }),
    pulse(now, {
      worker_id: "mac:fast",
      lane: "fast",
      pid: 11074,
      beat_at: ago(now, macBeat),
    }),
    pulse(now, {
      worker_id: "mac:hand",
      lane: "hand",
      pid: 3380,
      code_version: "c306f103 Mark the points: switch between",
      beat_at: ago(now, macAlive ? 9 : 22 * 60),
    }),
  ];
  if (scene === "running") {
    workers.push(
      pulse(now, {
        worker_id: "modal:main",
        lane: "main",
        host: "modal",
        pid: 41,
        code_version: `release ${RELEASE} cloud 9f1c2ab7d3e0`,
        started_at: ago(now, 14 * 60),
        beat_at: ago(now, 4),
        job_id: "job-cloud-1",
        job_kind: "deadspace_cut",
        match_id: "785e62eb-3b2b-4bcf-96f1-33931a85b091",
        stage: "ball",
        stage_note: "frame 21600/39738  61.3 fps  elapsed 352s",
        stage_pct: 54,
        host_load_1m: 3.1,
        host_cpu_count: 8,
        player: "Adil",
        job_created_at: ago(now, 58 * 60),
      }),
      pulse(now, {
        worker_id: "modal:fast",
        lane: "fast",
        host: "modal",
        pid: 42,
        code_version: `release ${RELEASE} cloud 9f1c2ab7d3e0`,
        started_at: ago(now, 14 * 60),
        beat_at: ago(now, 5),
        host_load_1m: 3.1,
        host_cpu_count: 8,
      }),
    );
  }

  const cloudMode = scene === "off" ? "disabled" : "automatic";
  const decision =
    scene === "running" || scene === "starting"
      ? {
          mode: "automatic",
          run: scene === "starting",
          reason: scene === "starting" ? "mac_silent_work_waiting" : "cloud_running",
          checked_at: ago(now, 30),
          mac_last_beat_at: ago(now, 22 * 60),
          mac_alive: false,
          mac_silent: true,
          mac_stale_s: 900,
          mac_release_id: RELEASE,
          cloud_mac_release_id: RELEASE,
          release_match: true,
          cloud_last_beat_at: scene === "running" ? ago(now, 4) : null,
          cloud_alive: scene === "running",
          session_recent: scene === "starting",
          waiting: 1,
          stuck: 1,
          oldest_wait_s: 22 * 60,
          oldest_wait_trigger_s: 1800,
        }
      : {
          mode: cloudMode,
          run: false,
          reason: scene === "off" ? "disabled" : "mac_reporting",
          checked_at: ago(now, 30),
          mac_last_beat_at: ago(now, 6),
          mac_alive: true,
          mac_silent: false,
          mac_stale_s: 900,
          mac_release_id: RELEASE,
          cloud_mac_release_id: RELEASE,
          release_match: true,
          cloud_last_beat_at: ago(now, 26 * 3600),
          cloud_alive: false,
          session_recent: false,
          waiting: 1,
          stuck: 0,
          oldest_wait_s: 9 * 60,
          oldest_wait_trigger_s: 1800,
        };

  return {
    now: now.toISOString(),
    workers,
    lesson: {
      cloud_enabled: false,
      mac_beat_at: ago(now, 40),
      mac_started_at: ago(now, 30 * 3600),
      release_id: "lesson-video-be1545cf1db13bae",
    },
    waiting: [
      {
        id: "job-w-1",
        kind: "deadspace_cut",
        created_at: ago(now, scene === "running" ? 58 * 60 : 9 * 60),
        original_name: "IMG_4412.MOV",
        match_id: "2277efbd-247f-40bd-a81c-a79139a082bd",
        player: "Adil",
        estimated_work_seconds: 2400,
        eta_latest_at: ago(now, -3600),
      },
    ],
    running: macAlive
      ? [
          {
            id: "job-mac-1",
            kind: "deadspace_cut",
            created_at: ago(now, 41 * 60),
            updated_at: ago(now, 20),
            progress: 51,
            original_name: "IMG_4398.MOV",
            match_id: "40e21600-4430-4dc5-9af2-65bf24e2679e",
            player: "Julian",
          },
        ]
      : scene === "running"
        ? [
            {
              id: "job-cloud-1",
              kind: "deadspace_cut",
              created_at: ago(now, 58 * 60),
              updated_at: ago(now, 12),
              progress: 38,
              original_name: "IMG_4380.MOV",
              match_id: "785e62eb-3b2b-4bcf-96f1-33931a85b091",
              player: "Adil",
            },
          ]
        : [],
    recent: [
      {
        id: "job-r-1",
        kind: "reclip",
        status: "done",
        created_at: ago(now, 70 * 60),
        updated_at: ago(now, 69 * 60),
        error: null,
        user_message: null,
        original_name: null,
        match_id: null,
        player: "Chris",
      },
      {
        id: "job-r-2",
        kind: "deadspace_cut",
        status: "done",
        created_at: ago(now, 3 * 3600),
        updated_at: ago(now, 2 * 3600),
        error: null,
        user_message: null,
        original_name: "IMG_4371.MOV",
        match_id: "b179c763-6226-41c2-aad7-17b95df4ffd1",
        player: "Adil",
      },
    ],
    day: { done: 14, failed: 1, cancelled: 0 },
    queue: [
      { queue_name: "jobs", queue_length: 1, oldest_msg_age_sec: 540 },
      { queue_name: "jobs_fast", queue_length: 0, oldest_msg_age_sec: null },
    ],
    reclip_lane: "fast",
    cloud: {
      cloud_mode: cloudMode,
      active_release_id: null,
      latest_dispatch_reason: decision.reason,
      daily_cap_usd: 3,
      monthly_cap_usd: 20,
      oldest_wait_s: 1800,
      mac_stale_s: 900,
      cloud_release_id: "9f1c2ab7d3e0c4f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819",
      cloud_pipeline_id: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819f1c2ab7d3e0c4f1",
      cloud_mac_release_id: RELEASE,
      cloud_source_commit: "fcc428b1650892ce400613983f18427a19ea5204",
      cloud_registered_at: ago(now, 5 * 3600),
      cloud_session_started_at:
        scene === "running" || scene === "starting" ? ago(now, scene === "starting" ? 70 : 14 * 60) : ago(now, 26 * 3600),
      cloud_session_ended_at:
        scene === "running" || scene === "starting" ? null : ago(now, 25 * 3600),
      cloud_session_note:
        scene === "running" || scene === "starting"
          ? "starting: mac_silent_work_waiting"
          : "the Mac is reporting again",
      cloud_decided_at: ago(now, 30),
      cloud_decision: decision,
    },
  };
}
