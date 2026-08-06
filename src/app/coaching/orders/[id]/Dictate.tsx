"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The app's one dictate idiom (Notes composer): a round mic button, a
 * red recording bar with the clock, a transcribing bar. This is the
 * write-up's ephemeral flavor — words land in the field, no audio kept
 * (persist=false; the document has nowhere to hang a recording).
 */
export function DictateButton({
  onTranscript,
  onError,
}: {
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setTranscribing(true);
        try {
          const blob = new Blob(chunks.current, { type: mime });
          const form = new FormData();
          form.append(
            "audio",
            blob,
            `dictation${mime === "audio/webm" ? ".webm" : ".mp4"}`,
          );
          form.append("persist", "false");
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });
          const data = (await res.json()) as { transcript?: string };
          if (res.ok && data.transcript) {
            onTranscript(data.transcript);
          } else if (!res.ok) {
            onError("Could not process the recording.");
          }
        } catch {
          onError("Could not process the recording.");
        }
        setTranscribing(false);
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      onError("Microphone unavailable.");
    }
  }

  if (recording) {
    return (
      <div className="flex h-9 items-center gap-2.5 rounded-full border border-edge bg-ink/60 px-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        <span className="text-sm tabular-nums text-red-300">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => recorder.current?.stop()}
          aria-label="Stop recording"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
          </svg>
        </button>
      </div>
    );
  }
  if (transcribing) {
    return (
      <div className="flex h-9 items-center gap-2.5 rounded-full border border-edge bg-ink/60 px-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-glow" />
        <span className="text-sm text-zinc-400">Transcribing…</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void start()}
      aria-label="Dictate into this section"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/40 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path strokeLinecap="round" d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  );
}
