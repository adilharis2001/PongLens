"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Speaking instead of typing, in one place.
 *
 * This is the journal composer's own flow, lifted out so the coach's entry
 * composer runs exactly the same one: record here, send it to the route
 * voice notes already use, drop the words into the draft. The audio is
 * never stored — an entry keeps only text.
 *
 * Two states in the copy, not three: "Speak instead" and "Stop", with a
 * quiet line while the words come back. The caller keeps Save disabled
 * until then, because a save that lands mid-transcription silently drops
 * what was said.
 */

export type DictationState = "idle" | "recording" | "writing";

export function useDictation({
  onText,
  onError,
}: {
  /** Words to add to the draft. Appended, never replacing. */
  onText: (words: string) => void;
  onError: (line: string) => void;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);

  const stopTracks = () => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
  };

  const start = useCallback(async () => {
    discardRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stopTracks();
        if (discardRef.current) {
          setState("idle");
          return;
        }
        setState("writing");
        try {
          const blob = new Blob(chunksRef.current, {
            type: rec.mimeType || "audio/webm",
          });
          const form = new FormData();
          form.append("audio", blob, "journal.webm");
          form.append("persist", "false");
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });
          const data = res.ok ? await res.json() : null;
          const words = String(data?.transcript ?? "").trim();
          if (!words) throw new Error("empty");
          onText(words);
        } catch {
          onError("Couldn't hear that clearly. Try again or type it.");
        } finally {
          setState("idle");
        }
      };
      rec.start();
      setState("recording");
    } catch {
      // Refused permission and no microphone at all land here alike, and
      // the person can only act on one of them.
      onError("Microphone unavailable. Check the browser's permission.");
    }
  }, [onError, onText]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  /** Closing the composer mid-recording: stop the hardware, keep nothing. */
  const cancel = useCallback(() => {
    discardRef.current = true;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    } else {
      stopTracks();
    }
  }, []);

  return { state, start, stop, cancel };
}

/**
 * The microphone that lives inside the text box, bottom right, where the
 * words land. Position it with a `relative` wrapper around the textarea.
 */
export function DictateMic({
  state,
  onStart,
  onStop,
}: {
  state: DictationState;
  onStart: () => void;
  onStop: () => void;
}) {
  const recording = state === "recording";
  return (
    <button
      type="button"
      onClick={recording ? onStop : onStart}
      disabled={state === "writing"}
      aria-label={recording ? "Stop recording" : "Speak instead"}
      className={`absolute bottom-3 right-2.5 flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
        recording
          ? "border-red-400/60 bg-red-500/10 text-red-300"
          : "border-edge bg-surface text-zinc-300 hover:border-cyan-glow/50 hover:text-white"
      } disabled:opacity-50`}
    >
      {recording ? (
        <span className="h-2.5 w-2.5 animate-pulse rounded-sm bg-red-400" />
      ) : (
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
      )}
    </button>
  );
}
