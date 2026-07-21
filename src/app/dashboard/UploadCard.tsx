"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const ACCEPTED = ["video/mp4", "video/quicktime"];
const ACCEPTED_EXT = [".mp4", ".mov"];

type Phase = "idle" | "uploading" | "finalizing" | "done" | "error";

type AnalysisKind =
  | "deadspace_cut"
  | "placement_map"
  | "spin_report"
  | "full_report";

const ANALYSIS_OPTIONS: {
  value: AnalysisKind;
  label: string;
  sub: string;
  enabled: boolean;
}[] = [
  {
    value: "deadspace_cut",
    label: "Cut to pure play",
    sub: "Removes everything between rallies",
    enabled: true,
  },
  {
    value: "placement_map",
    label: "Placement map",
    sub: "Where every ball lands",
    enabled: false,
  },
  {
    value: "spin_report",
    label: "Spin analysis",
    sub: "Read your opponent's spin",
    enabled: false,
  },
  {
    value: "full_report",
    label: "Match report",
    sub: "The full picture of a match",
    enabled: false,
  },
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

export function UploadCard({ userId }: { userId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [kind, setKind] = useState<AnalysisKind>("deadspace_cut");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startUpload = useCallback(
    async (file: File) => {
      setError(null);

      const okType =
        ACCEPTED.includes(file.type) || ACCEPTED_EXT.includes(extOf(file.name));
      if (!okType) {
        setError("Please upload an MP4 or MOV video.");
        setPhase("error");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError("That file is over 2 GB. Try trimming or compressing it.");
        setPhase("error");
        return;
      }

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

      setFileName(file.name);
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
              const etag = await putWithRetry(
                plan.partUrls[i],
                chunk,
                (sent) => {
                  sentByPart[i] = sent;
                  report();
                }
              );
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

        // 3. Queue the job.
        setPhase("finalizing");
        const { error: insertError } = await supabase.from("jobs").insert({
          user_id: userId,
          input_path: `r2://${plan.bucket}/${plan.key}`,
          original_name: file.name,
          kind,
          status: "queued",
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
        // Let the jobs list pick it up on its next poll.
        window.dispatchEvent(new CustomEvent("ponglens:job-created"));
      } catch (e) {
        setError(
          `Upload failed: ${e instanceof Error ? e.message : "network error"}. Please try again.`
        );
        setPhase("error");
      }
    },
    [userId, kind]
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (files && files.length > 0) {
        void startUpload(files[0]);
      }
    },
    [startUpload]
  );

  const busy = phase === "uploading" || phase === "finalizing";

  return (
    <section className="rounded-2xl border border-edge bg-surface p-6 sm:p-8">
      <h2 className="text-lg font-semibold">Analyze a match</h2>
      <p className="mt-1 text-sm text-zinc-400">MP4 or MOV, up to 2 GB.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ANALYSIS_OPTIONS.map((opt) => {
          const selected = kind === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={!opt.enabled || busy}
              aria-pressed={selected}
              onClick={() => opt.enabled && setKind(opt.value)}
              className={`relative rounded-xl border p-4 text-left transition-colors ${
                selected
                  ? "border-cyan-glow/60 bg-cyan-glow/10"
                  : opt.enabled
                    ? "border-edge bg-surface-2/40 hover:border-cyan-glow/40"
                    : "cursor-not-allowed border-edge bg-surface-2/20 opacity-60"
              }`}
            >
              {!opt.enabled && (
                <span className="absolute right-3 top-3 rounded-full border border-magenta-glow/50 bg-ink/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-magenta-soft">
                  Soon
                </span>
              )}
              <p
                className={`pr-10 text-sm font-semibold ${
                  selected ? "text-cyan-glow" : "text-zinc-200"
                }`}
              >
                {opt.label}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {opt.sub}
              </p>
            </button>
          );
        })}
      </div>

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
              {fileName}
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
              with your download link.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Typical turnaround: about 15 to 30 minutes.
            </p>
            <button
              onClick={() => {
                setPhase("idle");
                setProgress(0);
                setFileName(null);
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

      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
