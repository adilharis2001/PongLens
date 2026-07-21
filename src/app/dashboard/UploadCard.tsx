"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const ACCEPTED = ["video/mp4", "video/quicktime"];
const ACCEPTED_EXT = [".mp4", ".mov"];

type Phase = "idle" | "options" | "uploading" | "finalizing" | "done" | "error";
type Strictness = "tight" | "normal" | "loose";

const STRICTNESS: { value: Strictness; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "loose", label: "Loose" },
];

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** PUT a blob to a presigned URL with upload progress. Resolves to the ETag. */
function putWithProgress(
  url: string,
  blob: Blob,
  onProgress: (sentBytes: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader("ETag") ?? "");
      } else {
        reject(new Error(`upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.ontimeout = () => reject(new Error("upload timed out"));
    xhr.send(blob);
  });
}

const MAX_PART_ATTEMPTS = 3;

async function putWithRetry(
  url: string,
  blob: Blob,
  onProgress: (sentBytes: number) => void
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt++) {
    try {
      return await putWithProgress(url, blob, onProgress);
    } catch (e) {
      lastError = e;
      onProgress(0);
      if (attempt < MAX_PART_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 3000));
      }
    }
  }
  throw lastError;
}

type CreateUploadResponse =
  | { mode: "single"; bucket: string; key: string; url: string }
  | {
      mode: "multipart";
      bucket: string;
      key: string;
      uploadId: string;
      partSize: number;
      partUrls: string[];
    };

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
        on
          ? "border-cyan-glow/60 bg-cyan-glow/30"
          : "border-edge bg-surface-2"
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
  const [file, setFile] = useState<File | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Upload options (SPEC.md §2)
  const [points, setPoints] = useState(true);
  const [placement, setPlacement] = useState(false);
  const [strictness, setStrictness] = useState<Strictness>("normal");

  const pickFile = useCallback((f: File) => {
    setError(null);
    const okType =
      ACCEPTED.includes(f.type) || ACCEPTED_EXT.includes(extOf(f.name));
    if (!okType) {
      setError("Please upload an MP4 or MOV video.");
      setPhase("error");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("That file is over 2 GB. Try trimming or compressing it.");
      setPhase("error");
      return;
    }
    setFile(f);
    setPhase("options");
  }, []);

  const startUpload = useCallback(async () => {
    if (!file) return;
    setError(null);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("Your session expired. Refresh the page and sign in again.");
      setPhase("error");
      return;
    }
    setUserEmail(session.user.email ?? null);

    const contentType =
      extOf(file.name) === ".mov" || file.type === "video/quicktime"
        ? "video/quicktime"
        : "video/mp4";

    setPhase("uploading");
    setProgress(0);

    try {
      // 1. Ask the server for presigned R2 upload URLs.
      const createRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          fileSize: file.size,
          contentType,
        }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => null);
        throw new Error(body?.error ?? "could not start the upload");
      }
      const plan = (await createRes.json()) as CreateUploadResponse;

      // 2. Upload straight to R2.
      if (plan.mode === "single") {
        await putWithRetry(plan.url, file, (sent) =>
          setProgress(Math.round((sent / file.size) * 100))
        );
      } else {
        const sentByPart = new Array<number>(plan.partUrls.length).fill(0);
        const report = () => {
          const sent = sentByPart.reduce((a, b) => a + b, 0);
          setProgress(Math.round((sent / file.size) * 100));
        };
        const parts: { partNumber: number; etag: string }[] = [];
        try {
          for (let i = 0; i < plan.partUrls.length; i++) {
            const chunk = file.slice(
              i * plan.partSize,
              Math.min((i + 1) * plan.partSize, file.size)
            );
            const etag = await putWithRetry(plan.partUrls[i], chunk, (sent) => {
              sentByPart[i] = sent;
              report();
            });
            sentByPart[i] = chunk.size;
            report();
            parts.push({ partNumber: i + 1, etag });
          }
          const completeRes = await fetch("/api/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "complete",
              key: plan.key,
              uploadId: plan.uploadId,
              parts,
            }),
          });
          if (!completeRes.ok) {
            throw new Error("could not finalize the upload");
          }
        } catch (e) {
          // Best-effort abort so R2 doesn't hold orphaned parts.
          void fetch("/api/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "abort",
              key: plan.key,
              uploadId: plan.uploadId,
            }),
          }).catch(() => {});
          throw e;
        }
      }

      // 3. Queue the job. Options ride on jobs.options (SPEC.md §2).
      setPhase("finalizing");
      const { error: insertError } = await supabase.from("jobs").insert({
        user_id: userId,
        input_path: `r2://${plan.bucket}/${plan.key}`,
        original_name: file.name,
        kind: "deadspace_cut",
        status: "queued",
        options: {
          points,
          placement: points && placement,
          strictness,
        },
      });
      if (insertError) {
        setError(
          `Upload finished but we couldn't queue the job: ${insertError.message}`
        );
        setPhase("error");
        return;
      }
      setPhase("done");
      setProgress(100);
      // Let the lists pick it up on their next poll.
      window.dispatchEvent(new CustomEvent("ponglens:job-created"));
    } catch (e) {
      setError(
        `Upload failed: ${e instanceof Error ? e.message : "network error"}. Please try again.`
      );
      setPhase("error");
    }
  }, [file, userId, points, placement, strictness]);

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (files && files.length > 0) {
        pickFile(files[0]);
      }
    },
    [pickFile]
  );

  const busy = phase === "uploading" || phase === "finalizing";

  return (
    <section className="rounded-2xl border border-edge bg-surface p-5 sm:p-8">
      <h2 className="text-lg font-semibold">Upload a match</h2>
      <p className="mt-1 text-sm text-zinc-400">MP4 or MOV, up to 2 GB.</p>

      {phase === "options" && file ? (
        <div className="mt-6">
          <p className="truncate text-sm font-medium text-zinc-200">
            {file.name}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {(file.size / (1024 * 1024)).toFixed(0)} MB
          </p>

          <div className="mt-5 divide-y divide-edge/60 rounded-xl border border-edge bg-surface-2/40">
            <div className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-semibold text-zinc-200">
                  Cut the dead time
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Removes everything between rallies
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-edge bg-ink/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Always on
              </span>
            </div>

            <div className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-semibold text-zinc-200">
                  Break it into points
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  A clip for every point, with who served
                </p>
              </div>
              <Toggle on={points} onChange={setPoints} label="Break it into points" />
            </div>

            <div className="flex items-center justify-between gap-4 p-4">
              <div>
                <p
                  className={`text-sm font-semibold ${points ? "text-zinc-200" : "text-zinc-500"}`}
                >
                  Placement maps
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Adds processing time
                </p>
              </div>
              <Toggle
                on={points && placement}
                onChange={setPlacement}
                disabled={!points}
                label="Placement maps"
              />
            </div>

            <div className="p-4">
              <p className="text-sm font-semibold text-zinc-200">
                Cut strictness
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                How close we cut around play
              </p>
              <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-edge bg-ink/60 p-1">
                {STRICTNESS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={strictness === s.value}
                    onClick={() => setStrictness(s.value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      strictness === s.value
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

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => void startUpload()}
              className="glow-cta flex-1 rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink"
            >
              Upload
            </button>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setPhase("idle");
              }}
              className="rounded-full border border-edge px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!busy) onFiles(e.dataTransfer.files);
          }}
          className={`mt-6 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? "border-cyan-glow bg-cyan-glow/5"
              : "border-edge bg-surface-2/40"
          }`}
        >
          {busy ? (
            <div>
              <p className="truncate text-sm font-medium text-zinc-200">
                {file?.name}
              </p>
              <div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-ink">
                <div
                  className="h-full rounded-full bg-cyan-glow transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-zinc-400">
                {phase === "finalizing"
                  ? "Queuing your job…"
                  : `Uploading ${progress}%`}
              </p>
            </div>
          ) : phase === "done" ? (
            <div>
              <p className="text-sm font-medium text-emerald-400">
                Uploaded! We&apos;re on it. You&apos;ll get an email
                {userEmail ? (
                  <>
                    {" "}
                    at <span className="text-emerald-300">{userEmail}</span>
                  </>
                ) : null}{" "}
                when your match is ready.
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Typical turnaround: about 15 to 30 minutes.
              </p>
              <button
                onClick={() => {
                  setPhase("idle");
                  setProgress(0);
                  setFile(null);
                }}
                className="mt-4 rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
              >
                Upload another
              </button>
            </div>
          ) : (
            <div>
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
                Drag a video here, or{" "}
                <button
                  onClick={() => inputRef.current?.click()}
                  className="font-medium text-cyan-glow underline underline-offset-2 hover:text-white"
                >
                  browse files
                </button>
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Uploads go straight to secure storage. Big files are sent in
                chunks with automatic retries.
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
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
