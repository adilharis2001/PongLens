/**
 * A hand-marked match cut on the owner's iPhone (spec 2026-09-24, section
 * 7). Contract: docs/superpowers/specs/2026-09-25-device-hand-cut-contract.md.
 *
 * Pure: the object keys a phone job may write, which of them a request may
 * touch, and the words the player sees while the phone works. The route
 * (src/app/api/hand-cut/device/route.ts) and the pages call these; the
 * database (claim_device_hand_cut) hands the phone the same keys.
 */

/** Stages the phone reports through report_device_hand_cut. */
export const DEVICE_STAGES = ["device_cut", "device_clips", "device_upload", "device_paused"] as const;
export type DeviceStage = (typeof DEVICE_STAGES)[number];

/** How long without a report before the raw page offers the Mac instead. */
export const DEVICE_OFFER_MAC_AFTER_S = 24 * 3600;

export interface DeviceCutKeys {
  cut: string;
  manifest: string;
  clipPrefix: string;
}

/** The keys claim_device_hand_cut returns, in the media bucket. */
export function deviceCutKeys(userId: string, jobId: string, matchId: string): DeviceCutKeys {
  return {
    cut: `results/${userId}/${jobId}.mp4`,
    manifest: `results/${userId}/${jobId}.manifest.json`,
    clipPrefix: `points/${userId}/${matchId}`,
  };
}

/** The Mac's clip name: 01.mp4 ... 99.mp4, 100.mp4. */
export function clipName(idx: number): string {
  return `${String(idx).padStart(2, "0")}.mp4`;
}

/**
 * The point a clip key belongs to, or null when the key is not one of this
 * job's clips: it must sit in the job's clip folder, be named exactly as
 * the Mac names it, and number a point the frozen marks have.
 */
export function clipIndex(key: string, keys: DeviceCutKeys, points: number): number | null {
  const prefix = `${keys.clipPrefix}/`;
  if (!key.startsWith(prefix)) return null;
  const name = key.slice(prefix.length);
  const match = /^(\d{2,})\.mp4$/.exec(name);
  if (!match) return null;
  const idx = Number(match[1]);
  if (!Number.isInteger(idx) || idx < 1 || idx > points) return null;
  return clipName(idx) === name ? idx : null;
}

/** Whether a key is one this phone job may write. */
export function isWritableKey(key: string, keys: DeviceCutKeys, points: number): boolean {
  return key === keys.manifest || clipIndex(key, keys, points) !== null;
}

export interface PhoneJob {
  status: string;
  options: Record<string, unknown> | null;
}

/** The phone still holds this job: it may upload, report and submit. */
export function isPhoneJob(job: PhoneJob): boolean {
  const options = job.options ?? {};
  return job.status === "processing" && options.cutter === "device" && options.phase === "device";
}

/**
 * The clip keys a manifest names, checked against the job. Returns the
 * keys, or the reason the manifest cannot be submitted. Only the names are
 * read here; the Mac checks everything else.
 */
export function manifestClipKeys(
  manifest: unknown,
  keys: DeviceCutKeys,
  points: number,
): { keys: string[] } | { error: string } {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { error: "The manifest is not an object." };
  }
  const rows = (manifest as Record<string, unknown>).points;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > points) {
    return { error: "The manifest's points do not match the marks." };
  }
  const out: string[] = [];
  for (const row of rows) {
    const clip = row && typeof row === "object" ? (row as Record<string, unknown>).clip : undefined;
    if (clip === null) continue;
    if (typeof clip !== "string") return { error: "A point has no clip name." };
    const key = `${keys.clipPrefix}/${clip}`;
    if (clipIndex(key, keys, points) === null) return { error: `${clip} is not one of this cut's clips.` };
    out.push(key);
  }
  return { keys: out };
}

/** What the player reads while the phone works on the cut. */
export function deviceStageLabel(stage: string | null | undefined): string {
  if (stage === "device_upload") return "Uploading from your iPhone";
  if (stage === "device_paused") return "Paused on your iPhone";
  return "Cutting on your iPhone";
}

/** Seconds since the phone last reported (or was handed the job). */
export function deviceQuietSeconds(seenAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!seenAt) return null;
  const at = Date.parse(seenAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((now - at) / 1000));
}

/** Whether the raw page offers "Cut on the Mac instead". */
export function offerMacInstead(seenAt: string | null | undefined, now: number = Date.now()): boolean {
  const quiet = deviceQuietSeconds(seenAt, now);
  return quiet !== null && quiet >= DEVICE_OFFER_MAC_AFTER_S;
}
