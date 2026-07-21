"use client";

import { useCallback, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const ACCEPTED = ["video/mp4", "video/quicktime"];
const ACCEPTED_EXT = [".mp4", ".mov"];

type Phase = "idle" | "uploading" | "finalizing" | "done" | "error";

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function UploadCard({ userId }: { userId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<tus.Upload | null>(null);

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
        setError("Your session expired — refresh the page and sign in again.");
        setPhase("error");
        return;
      }

      const ext = extOf(file.name) === ".mov" ? ".mov" : ".mp4";
      const objectName = `${userId}/${crypto.randomUUID()}${ext}`;
      const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

      setFileName(file.name);
      setPhase("uploading");
      setProgress(0);

      const upload = new tus.Upload(file, {
        endpoint: `${projectUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "x-upsert": "false",
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: "uploads",
          objectName,
          contentType: file.type || "video/mp4",
          cacheControl: "3600",
        },
        // Supabase resumable uploads require exactly 6 MB chunks.
        chunkSize: 6 * 1024 * 1024,
        onError(err) {
          setError(
            `Upload failed: ${err.message ?? "network error"}. You can retry — resumable uploads pick up where they left off.`
          );
          setPhase("error");
        },
        onProgress(sent, total) {
          setProgress(Math.round((sent / total) * 100));
        },
        async onSuccess() {
          setPhase("finalizing");
          const { error: insertError } = await supabase.from("jobs").insert({
            user_id: userId,
            input_path: objectName,
            original_name: file.name,
            kind: "deadspace_cut",
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
        },
      });

      uploadRef.current = upload;
      const previous = await upload.findPreviousUploads();
      if (previous.length > 0) {
        upload.resumeFromPreviousUpload(previous[0]);
      }
      upload.start();
    },
    [userId]
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
      <h2 className="text-lg font-semibold">Upload a match</h2>
      <p className="mt-1 text-sm text-zinc-400">
        MP4 or MOV, up to 2 GB. We&apos;ll cut the dead time and hand back pure
        play.
      </p>

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
                : `Uploading — ${progress}%`}
            </p>
          </div>
        ) : phase === "done" ? (
          <div>
            <p className="text-sm font-medium text-emerald-400">
              Uploaded and queued. Processing has begun — check the list below.
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
              Uploads are resumable — a flaky connection won&apos;t lose your
              progress.
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
