"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import { createClient } from "@/lib/supabase/client";
import { setUploading } from "@/lib/uploadGuard";
import { QUOTA_ERRORS } from "@/lib/quota";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const PART_SIZE = 16 * 1024 * 1024; // 16 MiB parts: mobile-friendly, R2 min is 5 MiB
const ACCEPTED = ["video/mp4", "video/quicktime"];
const ACCEPTED_EXT = [".mp4", ".mov"];
const PENDING_KEY = "ponglens:pending-upload";
const PENDING_MAX_AGE = 6 * 24 * 3600 * 1000; // R2 aborts incomplete uploads at 7d

type Phase =
  | "idle"
  | "uploading"
  | "finishing"
  | "done"
  | "error"
  | "interrupted";
type Strictness = "tight" | "normal" | "loose";
type MatchType = "" | "practice" | "league" | "tournament";

type FormState = {
  opponent: string;
  matchType: MatchType;
  points: boolean;
  placement: boolean;
  strictness: Strictness;
};

const DEFAULT_FORM: FormState = {
  opponent: "",
  matchType: "",
  points: true,
  placement: false,
  strictness: "normal",
};

type PendingUpload = {
  bucket: string;
  key: string;
  uploadId: string;
  name: string;
  size: number;
  contentType: string;
  startedAt: number;
  form: FormState;
};

const STRICTNESS: { value: Strictness; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "loose", label: "Loose" },
];

const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: "practice", label: "Practice" },
  { value: "league", label: "League" },
  { value: "tournament", label: "Tournament" },
];

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function contentTypeOf(file: File) {
  return extOf(file.name) === ".mov" || file.type === "video/quicktime"
    ? "video/quicktime"
    : "video/mp4";
}

function readPending(): PendingUpload | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as PendingUpload;
    if (!rec.key || !rec.uploadId || !rec.size) return null;
    if (Date.now() - rec.startedAt > PENDING_MAX_AGE) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

function writePending(rec: PendingUpload) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(rec));
  } catch {}
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {}
}

// @uppy/aws-s3 rate-limits signing requests but deliberately runs part PUTs
// outside its queue (priority Infinity), so a big file would otherwise fire
// every part at once and exhaust browser sockets/memory. This tiny semaphore
// caps the actual part uploads.
const PART_CONCURRENCY = 4;
let partsActive = 0;
const partWaiters: (() => void)[] = [];
async function withPartSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (partsActive >= PART_CONCURRENCY) {
    await new Promise<void>((resolve) => partWaiters.push(resolve));
  }
  partsActive++;
  try {
    return await fn();
  } finally {
    partsActive--;
    partWaiters.shift()?.();
  }
}

async function api(payload: Record<string, unknown>, signal?: AbortSignal) {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }
  return res.json();
}

function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
        on ? "border-cyan-glow/60 bg-cyan-glow/30" : "border-edge bg-surface-2"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
          on ? "left-6 bg-cyan-glow" : "left-0.5 bg-zinc-500"
        }`}
      />
    </button>
  );
}

export function UploadCard({ userId }: { userId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const inputRef = useRef<HTMLInputElement>(null);

  const uppyRef = useRef<Uppy | null>(null);
  const formRef = useRef<FormState>(form);
  const phaseRef = useRef<Phase>(phase);
  const uploadRef = useRef<{ bucket: string; key: string; name: string } | null>(
    null
  );
  const errorKindRef = useRef<"upload" | "queue">("upload");
  const jobIdRef = useRef<string | null>(null);
  const jobOptionsRef = useRef<Record<string, unknown> | null>(null);
  const [detailsSaved, setDetailsSaved] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  formRef.current = form;
  phaseRef.current = phase;

  // --- Screen wake lock: keep the phone awake while uploading -------------
  const acquireWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        console.log("[ponglens] wake lock acquired");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
          console.log("[ponglens] wake lock released");
        });
      }
    } catch {
      // Unsupported or denied: uploading still works, screen may sleep.
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const active = phase === "uploading" || phase === "finishing";

  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, acquireWakeLock]);

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  // Let the app nav guard in-app navigation the same way.
  useEffect(() => {
    setUploading(active);
    return () => setUploading(false);
  }, [active]);

  // On mount: if a previous upload never finished, offer to resume it.
  useEffect(() => {
    const rec = readPending();
    if (rec) {
      setForm(rec.form ?? DEFAULT_FORM);
      setFileName(rec.name);
      setPhase("interrupted");
    }
  }, []);

  // Keep the saved form in sync so a resume restores the user's answers.
  useEffect(() => {
    if (phase !== "uploading" && phase !== "finishing") return;
    const rec = readPending();
    if (rec) writePending({ ...rec, form });
  }, [form, phase]);

  // --- Queue the processing job once the file is in R2 --------------------
  const queueJob = useCallback(async () => {
    const up = uploadRef.current;
    if (!up) return;
    setPhase("finishing");
    const f = formRef.current;
    const supabase = createClient();
    const { data: inserted, error: insertError } = await supabase.from("jobs").insert({
      user_id: userId,
      input_path: `r2://${up.bucket}/${up.key}`,
      original_name: up.name,
      kind: "deadspace_cut",
      status: "queued",
      options: {
        points: f.points,
        placement: f.points && f.placement,
        strictness: f.strictness,
        meta: {
          opponent_name: f.opponent.trim() || null,
          match_type: f.matchType || null,
        },
      },
    }).select("id, options").single();
    if (insertError) {
      errorKindRef.current = "queue";
      setError("Upload finished but we couldn't start processing.");
      setPhase("error");
      return;
    }
    releaseWakeLock();
    jobIdRef.current = inserted?.id ?? null;
    jobOptionsRef.current = inserted?.options ?? null;
    setPhase("done");
    window.dispatchEvent(new CustomEvent("ponglens:job-created"));
  }, [userId, releaseWakeLock]);

  // --- Build a headless Uppy wired to our presign routes ------------------
  const buildUppy = useCallback(
    (file: File, resume: PendingUpload | null) => {
      uppyRef.current?.destroy();
      const contentType = contentTypeOf(file);
      const uppy = new Uppy({ autoProceed: false });

      uppy.use(AwsS3, {
        // 4 parts in flight keeps memory + connection use sane on phones.
        limit: 4,
        uploadPartBytes: (opts) => withPartSlot(() => AwsS3.uploadPartBytes(opts)),
        shouldUseMultipart: true,
        getChunkSize: () => PART_SIZE,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        createMultipartUpload: async () => {
          const res = (await api({
            action: "create",
            fileSize: file.size,
            contentType,
          })) as { bucket: string; key: string; uploadId: string };
          uploadRef.current = {
            bucket: res.bucket,
            key: res.key,
            name: file.name,
          };
          writePending({
            bucket: res.bucket,
            key: res.key,
            uploadId: res.uploadId,
            name: file.name,
            size: file.size,
            contentType,
            startedAt: Date.now(),
            form: formRef.current,
          });
          return { uploadId: res.uploadId, key: res.key };
        },
        signPart: async (_f, { key, uploadId, partNumber, signal }) => {
          const res = await api(
            { action: "sign-part", key, uploadId, partNumber },
            signal ?? undefined
          );
          return { url: res.url as string };
        },
        listParts: async (_f, { key, uploadId, signal }) => {
          const res = await api(
            { action: "list-parts", key, uploadId },
            signal ?? undefined
          );
          console.log(
            `[ponglens] resume: ${res.parts.length} part(s) already in R2, skipping them`
          );
          return res.parts;
        },
        completeMultipartUpload: async (_f, { key, uploadId, parts }) => {
          await api({ action: "complete", key, uploadId, parts });
          return {};
        },
        abortMultipartUpload: async (_f, { key, uploadId }) => {
          await api({ action: "abort", key, uploadId });
        },
      });

      uppy.on("progress", (pct) => {
        setProgress(Math.min(100, Math.round(pct)));
      });
      uppy.on("upload-success", () => {
        clearPending();
        void queueJob();
      });
      uppy.on("upload-error", (_file, err) => {
        errorKindRef.current = "upload";
        // Quota/limit rejections from /api/upload-url carry an exact,
        // user-facing message — show it as-is.
        const msg = err?.message ?? "";
        const quota = Object.values(QUOTA_ERRORS).find((q) => msg.includes(q));
        setError(
          quota ??
            (/network|fetch|load/i.test(msg)
              ? "The connection dropped."
              : "The upload hit a snag.")
        );
        setPhase("error");
      });

      const id = uppy.addFile({
        name: file.name,
        type: contentType,
        data: file,
      });

      if (resume) {
        uploadRef.current = {
          bucket: resume.bucket,
          key: resume.key,
          name: resume.name,
        };
        // Seeding s3Multipart makes @uppy/aws-s3 restore the upload:
        // it calls listParts and skips parts that are already in R2.
        uppy.setFileState(id, {
          s3Multipart: { key: resume.key, uploadId: resume.uploadId },
        } as unknown as Parameters<Uppy["setFileState"]>[1]);
      }

      uppyRef.current = uppy;
      return uppy;
    },
    [queueJob]
  );

  // --- Start (or resume) the moment a file is picked ----------------------
  const beginUpload = useCallback(
    (file: File) => {
      setError(null);
      const okType =
        ACCEPTED.includes(file.type) || ACCEPTED_EXT.includes(extOf(file.name));
      if (!okType) {
        errorKindRef.current = "upload";
        setError("That's not an MP4 or MOV video.");
        setPhase("error");
        return;
      }
      if (file.size > MAX_BYTES) {
        errorKindRef.current = "upload";
        setError("That file is over 2 GB.");
        setPhase("error");
        return;
      }

      let resume = readPending();
      if (resume && (resume.name !== file.name || resume.size !== file.size)) {
        // Different file: drop the old unfinished upload and start fresh.
        void api({
          action: "abort",
          key: resume.key,
          uploadId: resume.uploadId,
        }).catch(() => {});
        clearPending();
        resume = null;
      }
      if (resume) setForm(resume.form ?? DEFAULT_FORM);

      setFileName(file.name);
      setProgress(0);
      setPhase("uploading");
      void acquireWakeLock();

      const uppy = buildUppy(file, resume);
      uppy.upload().catch(() => {
        // Errors surface through the upload-error handler.
      });
    },
    [acquireWakeLock, buildUppy]
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (files && files.length > 0) beginUpload(files[0]);
    },
    [beginUpload]
  );

  const cancelUpload = useCallback(() => {
    uppyRef.current?.cancelAll();
    uppyRef.current?.destroy();
    uppyRef.current = null;
    clearPending();
    releaseWakeLock();
    setPhase("idle");
    setProgress(0);
    setFileName(null);
    setForm(DEFAULT_FORM);
  }, [releaseWakeLock]);

  const discardInterrupted = useCallback(() => {
    const rec = readPending();
    if (rec) {
      void api({ action: "abort", key: rec.key, uploadId: rec.uploadId }).catch(
        () => {}
      );
    }
    clearPending();
    setPhase("idle");
    setFileName(null);
    setForm(DEFAULT_FORM);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    if (errorKindRef.current === "queue") {
      void queueJob();
      return;
    }
    if (uppyRef.current) {
      setPhase("uploading");
      void acquireWakeLock();
      uppyRef.current.retryAll().catch(() => {});
    } else if (readPending()) {
      setPhase("interrupted");
    } else {
      setPhase("idle");
    }
  }, [queueJob, acquireWakeLock]);

  const saveDetails = useCallback(async () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    setDetailsSaved("saving");
    const f = formRef.current;
    const supabase = createClient();
    const meta = {
      opponent_name: f.opponent.trim() || null,
      match_type: f.matchType || null,
    };
    // Update the job's options (worker copies them into the match). If the
    // match already exists (fast processing), update it directly too.
    const base = jobOptionsRef.current ?? {};
    await supabase
      .from("jobs")
      .update({ options: { ...base, meta } })
      .eq("id", jobId);
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .eq("job_id", jobId)
      .maybeSingle();
    if (match) {
      await supabase
        .from("matches")
        .update({
          opponent_name: meta.opponent_name,
          ...(meta.match_type ? { match_type: meta.match_type } : {}),
        })
        .eq("id", match.id);
    }
    setDetailsSaved("saved");
  }, []);

  const reset = useCallback(() => {
    uppyRef.current?.destroy();
    uppyRef.current = null;
    uploadRef.current = null;
    setPhase("idle");
    setProgress(0);
    setFileName(null);
    setError(null);
    setForm(DEFAULT_FORM);
  }, []);

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  }, []);

  return (
    <section className="rounded-2xl border border-edge bg-surface p-5 sm:p-8">
      <h2 className="text-lg font-semibold">Upload a match</h2>
      <p className="mt-1 text-sm text-zinc-400">MP4 or MOV, up to 2 GB.</p>

      {active ? (
        <div className="mt-6">
          {/* Progress: big number, thin bar, one word. */}
          <div className="flex items-baseline justify-between">
            <p className="text-4xl font-semibold tabular-nums text-zinc-100">
              {progress}
              <span className="text-xl text-zinc-500">%</span>
            </p>
            <p className="text-sm text-zinc-400">
              {phase === "finishing" ? "Finishing up" : "Uploading"}
            </p>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink">
            <div
              className="h-full rounded-full bg-cyan-glow transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 truncate text-xs text-zinc-500">{fileName}</p>

          {/* Metadata + options, answerable while the upload runs. */}
          <div className="mt-6 space-y-4">
            <input
              type="text"
              value={form.opponent}
              onChange={(e) => setField("opponent", e.target.value)}
              placeholder="Opponent name"
              autoComplete="off"
              enterKeyHint="done"
              className="w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
            />

            <div className="grid grid-cols-3 gap-2">
              {MATCH_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={form.matchType === t.value}
                  onClick={() =>
                    setField(
                      "matchType",
                      form.matchType === t.value ? "" : t.value
                    )
                  }
                  className={`rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                    form.matchType === t.value
                      ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="divide-y divide-edge/60 rounded-xl border border-edge bg-surface-2/40">
              <div className="flex items-center justify-between gap-4 p-3.5">
                <p className="text-sm text-zinc-200">Break it into points</p>
                <Toggle
                  on={form.points}
                  onChange={(v) => setField("points", v)}
                  label="Break it into points"
                />
              </div>
              <div className="flex items-center justify-between gap-4 p-3.5">
                <div>
                  <p
                    className={`text-sm ${form.points ? "text-zinc-200" : "text-zinc-500"}`}
                  >
                    Placement maps
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Adds processing time
                  </p>
                </div>
                <Toggle
                  on={form.points && form.placement}
                  onChange={(v) => setField("placement", v)}
                  disabled={!form.points}
                  label="Placement maps"
                />
              </div>
              <div className="p-3.5">
                <p className="text-sm text-zinc-200">Cut strictness</p>
                <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg border border-edge bg-ink/60 p-1">
                  {STRICTNESS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      aria-pressed={form.strictness === s.value}
                      onClick={() => setField("strictness", s.value)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        form.strictness === s.value
                          ? "bg-cyan-glow/15 text-cyan-glow"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={cancelUpload}
              className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
            >
              Cancel upload
            </button>
          </div>
        </div>
      ) : phase === "interrupted" ? (
        <div className="mt-6 rounded-2xl border border-edge bg-surface-2/40 p-6 text-center">
          <p className="text-sm text-zinc-200">
            Upload interrupted. Pick the same video to continue.
          </p>
          <p className="mt-1 truncate text-xs text-zinc-500">{fileName}</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="glow-cta mt-4 rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink"
          >
            Pick video
          </button>
          <div className="mt-3">
            <button
              type="button"
              onClick={discardInterrupted}
              className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
            >
              Start over
            </button>
          </div>
        </div>
      ) : phase === "done" ? (
        <div className="mt-6 rounded-2xl border border-edge bg-surface-2/40 p-6">
          <p className="text-center text-sm font-medium text-emerald-400">
            Done. Processing starts now.
          </p>
          <p className="mt-1 text-center text-xs text-zinc-500">
            You&apos;ll get an email when it&apos;s ready.
          </p>
          <div className="mx-auto mt-5 max-w-sm">
            <label className="block">
              <span className="text-xs font-medium text-zinc-400">Opponent</span>
              <input
                type="text"
                value={form.opponent}
                onChange={(e) => {
                  setForm((f) => ({ ...f, opponent: e.target.value }));
                  setDetailsSaved("idle");
                }}
                placeholder="Name"
                className="mt-1 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
              />
            </label>
            <div className="mt-3 flex gap-2">
              {MATCH_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      matchType: f.matchType === t.value ? "" : t.value,
                    }));
                    setDetailsSaved("idle");
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.matchType === t.value
                      ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : "border-edge text-zinc-400"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void saveDetails()}
              disabled={detailsSaved !== "idle"}
              className="glow-cta mt-4 w-full rounded-full bg-cyan-glow py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {detailsSaved === "saved"
                ? "Saved"
                : detailsSaved === "saving"
                  ? "Saving…"
                  : "Save details"}
            </button>
          </div>
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              Upload another
            </button>
          </div>
        </div>
      ) : phase === "error" ? (
        <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 rounded-full border border-edge bg-surface px-6 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-cyan-glow/50"
          >
            Retry
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
          className={`mt-6 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? "border-cyan-glow bg-cyan-glow/5"
              : "border-edge bg-surface-2/40"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="mx-auto h-10 w-10 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16V4m0 0-4 4m4-4 4 4M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"
            />
          </svg>
          <p className="mt-3 text-sm text-zinc-300">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="font-medium text-cyan-glow underline underline-offset-2 hover:text-white"
            >
              Choose a video
            </button>{" "}
            or drag one here
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            The upload starts right away.
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </section>
  );
}
