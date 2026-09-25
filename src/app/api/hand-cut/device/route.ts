import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MEDIA_BUCKET,
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  deleteObjects,
  getObject,
  headObject,
  listParts,
  presignPut,
  presignUploadPart,
} from "@/lib/r2";
import {
  deviceCutKeys,
  isPhoneJob,
  isWritableKey,
  manifestClipKeys,
  type DeviceCutKeys,
} from "@/lib/deviceHandCut";

export const runtime = "nodejs";

// A cut is the whole match at source resolution, re-encoded. The largest
// original accepted is 6 GB, and the phone's bitrate can sit above a
// low-bitrate original's, so the ceiling leaves room over it.
const MAX_CUT_BYTES = 12 * 1024 * 1024 * 1024;
const MAX_PARTS = 10_000; // R2 hard limit
const MAX_CLIP_BYTES = 60 * 1024 * 1024; // the same ceiling as /api/point-clip
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024; // hand_cut_device.MANIFEST_MAX_BYTES
const MAX_SIGN_KEYS = 100;
// Short, so a phone that loses the job cannot keep writing for long with
// URLs it already holds. The phone signs a batch just before sending it.
const PUT_URL_S = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/hand-cut/device — uploads for a hand cut made on the owner's
 * iPhone (contract: docs/superpowers/specs/2026-09-25-device-hand-cut-contract.md,
 * section 4). Bearer token from the app, cookies on the web.
 *
 * Every action but `release` needs the job to be the caller's hand cut in
 * phase 'device', and every key is derived here from the job, the match
 * that links to it and the frozen marks, never taken from the request:
 *
 *   create      { jobId, fileSize }                 -> { bucket, key, uploadId }
 *   sign-part   { jobId, uploadId, partNumber }     -> { url }
 *   list-parts  { jobId, uploadId }                 -> { parts } | { parts: [], gone: true }
 *   complete    { jobId, uploadId, parts }          -> { ok, bytes }
 *   abort       { jobId, uploadId }                 -> { ok }
 *   sign        { jobId, keys: [...] }              -> { urls: { key: url } }
 *   submit      { jobId }                           -> { ok, phase: "verify" }
 *   release     { jobId, toMac }                    -> the RPC's answer
 *
 * Storage: no quota check, on purpose. A hand cut's video and clips are
 * derived from an original the player already stores, and the Mac's own
 * hand cut writes the same files without asking; refusing the phone would
 * only move the same bytes to the Mac. The Mac books them in the storage
 * ledger when it publishes, and the nightly measurement sees them before.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const jobId = String(body.jobId ?? "");
  if (!UUID.test(jobId)) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, user_id, kind, status, options")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.user_id !== user.id || job.kind !== "hand_cut") {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const options = (job.options ?? {}) as Record<string, unknown>;

  try {
    if (action === "release") {
      return await release(supabase, job.id, user.id, body, options);
    }

    if (!isPhoneJob({ status: job.status, options })) {
      return NextResponse.json(
        { error: "This cut is no longer on the iPhone.", phase: options.phase ?? null },
        { status: 409 },
      );
    }

    // The match is the one linked to this job (a column the owner cannot
    // write), and the number of clips is the frozen marks' count.
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .eq("job_id", job.id)
      .maybeSingle();
    const { data: draft } = match
      ? await supabase
          .from("hand_cut_drafts")
          .select("marks, submitted_at")
          .eq("match_id", match.id)
          .maybeSingle()
      : { data: null };
    if (!match || !draft || !draft.submitted_at || !Array.isArray(draft.marks)) {
      return NextResponse.json(
        { error: "This cut is no longer on the iPhone.", phase: options.phase ?? null },
        { status: 409 },
      );
    }
    const points = draft.marks.length;
    const keys = deviceCutKeys(user.id, job.id, match.id);

    switch (action) {
      case "create":
        return await createCut(keys, body);
      case "sign-part":
      case "list-parts":
      case "complete":
      case "abort":
        return await multipart(action, keys, body);
      case "sign":
        return await sign(keys, points, body);
      case "submit":
        return await submit(supabase, job.id, keys, points);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    console.error("hand-cut/device error:", e);
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function createCut(keys: DeviceCutKeys, body: Record<string, unknown>) {
  const fileSize = Number(body.fileSize);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
  }
  if (fileSize > MAX_CUT_BYTES) {
    return NextResponse.json({ error: "The cut is too large" }, { status: 413 });
  }
  const uploadId = await createMultipartUpload(MEDIA_BUCKET, keys.cut, "video/mp4");
  return NextResponse.json({ bucket: MEDIA_BUCKET, key: keys.cut, uploadId });
}

async function multipart(
  action: "sign-part" | "list-parts" | "complete" | "abort",
  keys: DeviceCutKeys,
  body: Record<string, unknown>,
) {
  const uploadId = String(body.uploadId ?? "");
  if (!uploadId) {
    return NextResponse.json({ error: "uploadId is required" }, { status: 400 });
  }
  if (action === "sign-part") {
    const partNumber = Number(body.partNumber);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
      return NextResponse.json({ error: "Invalid part" }, { status: 400 });
    }
    const url = await presignUploadPart(MEDIA_BUCKET, keys.cut, uploadId, partNumber);
    return NextResponse.json({ url });
  }
  if (action === "list-parts") {
    const parts = await listParts(MEDIA_BUCKET, keys.cut, uploadId);
    if (parts === null) return NextResponse.json({ parts: [], gone: true });
    return NextResponse.json({ parts });
  }
  if (action === "abort") {
    await abortMultipartUpload(MEDIA_BUCKET, keys.cut, uploadId);
    return NextResponse.json({ ok: true });
  }
  const raw = body.parts;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "No parts" }, { status: 400 });
  }
  const parts = (raw as Record<string, unknown>[]).map((p) => ({
    partNumber: Number(p.PartNumber ?? p.partNumber),
    etag: String(p.ETag ?? p.etag ?? ""),
  }));
  if (parts.some((p) => !Number.isInteger(p.partNumber) || !p.etag)) {
    return NextResponse.json({ error: "Bad parts" }, { status: 400 });
  }
  await completeMultipartUpload(MEDIA_BUCKET, keys.cut, uploadId, parts);
  const bytes = await headObject(MEDIA_BUCKET, keys.cut);
  if (bytes !== null && bytes > MAX_CUT_BYTES) {
    await deleteObjects(MEDIA_BUCKET, [keys.cut]).catch(() => undefined);
    return NextResponse.json({ error: "The cut is too large" }, { status: 413 });
  }
  return NextResponse.json({ ok: true, bytes: bytes ?? 0 });
}

async function sign(keys: DeviceCutKeys, points: number, body: Record<string, unknown>) {
  const requested = body.keys;
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > MAX_SIGN_KEYS) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_SIGN_KEYS} keys` },
      { status: 400 },
    );
  }
  const wanted = requested.map((k) => String(k));
  const refused = wanted.filter((k) => !isWritableKey(k, keys, points));
  if (refused.length > 0) {
    return NextResponse.json(
      { error: "Those keys do not belong to this cut", refused },
      { status: 403 },
    );
  }
  const urls: Record<string, string> = {};
  for (const key of new Set(wanted)) {
    urls[key] = await presignPut(MEDIA_BUCKET, key, PUT_URL_S);
  }
  return NextResponse.json({ urls });
}

/** HEAD a batch of keys, a few at a time. */
async function sizes(keys: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const CONCURRENCY = 8;
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    await Promise.all(
      keys.slice(i, i + CONCURRENCY).map(async (key) => {
        out.set(key, await headObject(MEDIA_BUCKET, key));
      }),
    );
  }
  return out;
}

async function submit(supabase: Supabase, jobId: string, keys: DeviceCutKeys, points: number) {
  const object = await getObject(MEDIA_BUCKET, keys.manifest);
  if (!object) {
    return NextResponse.json(
      { error: "Upload the manifest first", missing: [keys.manifest] },
      { status: 409 },
    );
  }
  if (object.body.byteLength > MAX_MANIFEST_BYTES) {
    return NextResponse.json({ error: "The manifest is too large" }, { status: 413 });
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(object.body));
  } catch {
    return NextResponse.json({ error: "The manifest is not JSON" }, { status: 400 });
  }
  const clips = manifestClipKeys(manifest, keys, points);
  if ("error" in clips) {
    return NextResponse.json({ error: clips.error }, { status: 400 });
  }

  const measured = await sizes([keys.cut, ...clips.keys]);
  const missing = [...measured.entries()]
    .filter(([, bytes]) => bytes === null || bytes <= 0)
    .map(([key]) => key);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Some files did not finish uploading", missing },
      { status: 409 },
    );
  }
  const oversized = clips.keys.filter((key) => (measured.get(key) ?? 0) > MAX_CLIP_BYTES);
  if (oversized.length > 0) {
    return NextResponse.json({ error: "A clip is too large", oversized }, { status: 413 });
  }

  const cutBytes = measured.get(keys.cut) ?? 0;
  const clipBytes = clips.keys.reduce((sum, key) => sum + (measured.get(key) ?? 0), 0);
  const { data, error } = await supabase.rpc("submit_device_hand_cut", {
    p_job: jobId,
    p_manifest: {
      key: keys.manifest,
      bytes: object.body.byteLength,
      cut_bytes: cutBytes,
      clip_bytes: clipBytes,
      clips: clips.keys.length,
      points: (manifest as { points: unknown[] }).points.length,
    },
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("bad_state")) {
      return NextResponse.json({ error: "This cut is no longer on the iPhone." }, { status: 409 });
    }
    if (message.includes("invalid_manifest")) {
      return NextResponse.json({ error: "The manifest was refused" }, { status: 400 });
    }
    throw new Error(`submit_device_hand_cut: ${message}`);
  }
  return NextResponse.json({ ok: true, phase: (data as { phase?: string } | null)?.phase ?? "verify" });
}

async function release(
  supabase: Supabase,
  jobId: string,
  userId: string,
  body: Record<string, unknown>,
  options: Record<string, unknown>,
) {
  if (typeof body.toMac !== "boolean") {
    return NextResponse.json({ error: "toMac must be true or false" }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("release_device_hand_cut", {
    p_job: jobId,
    p_to_mac: body.toMac,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("bad_state")) {
      return NextResponse.json(
        { error: "This cut is no longer on the iPhone.", phase: options.phase ?? null },
        { status: 409 },
      );
    }
    throw new Error(`release_device_hand_cut: ${message}`);
  }
  const answer = (data ?? {}) as { job_id?: string; phase?: string };
  if (!body.toMac && answer.phase === "released") {
    // Only this job's own objects: its cut and manifest carry the job id.
    // Clips share their names with the next cut of the same match, which
    // overwrites them, so they are left alone rather than raced.
    const { cut, manifest } = deviceCutKeys(userId, jobId, "");
    await deleteObjects(MEDIA_BUCKET, [cut, manifest]).catch(() => undefined);
  }
  return NextResponse.json(answer);
}
