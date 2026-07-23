"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Note } from "@/lib/types";

function timeShort(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * One note in the thread. Notes are annotations, not chat: every entry
 * is left-aligned under an author line, with a thin accent bar instead
 * of a bubble — cyan for the player, amber for the coach.
 */
export function NoteItem({
  note,
  matchId,
  ownerId,
  viewerId,
}: {
  note: Note;
  matchId: string;
  ownerId: string;
  viewerId: string;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState(false);

  const isCoachNote = note.author_id !== ownerId;
  const isMine = note.author_id === viewerId;
  const authorLabel = isMine ? "You" : isCoachNote ? "Coach" : "Player";

  const loadAudio = useCallback(async () => {
    setAudioLoading(true);
    setAudioError(false);
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, noteId: note.id }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      setAudioUrl(data.url);
    } catch {
      setAudioError(true);
    } finally {
      setAudioLoading(false);
    }
  }, [matchId, note.id]);

  return (
    <li
      className={`border-l-2 py-0.5 pl-3.5 ${
        isCoachNote ? "border-amber-400/50" : "border-cyan-glow/40"
      }`}
    >
      <p className="text-[11px] text-zinc-500">
        <span
          className={`font-semibold ${
            isCoachNote ? "text-amber-300" : "text-zinc-400"
          }`}
        >
          {authorLabel}
        </span>{" "}
        · {timeShort(note.created_at)}
      </p>
      <div>
        {note.body && (
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-200">
            {note.body}
          </p>
        )}
        {note.audio_path &&
          (audioUrl ? (
            <audio src={audioUrl} controls autoPlay className="mt-2 h-9 w-full" />
          ) : (
            <button
              type="button"
              onClick={() => void loadAudio()}
              disabled={audioLoading}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-edge bg-ink/40 px-3 py-1 text-xs text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-60"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
              {audioLoading
                ? "Loading…"
                : audioError
                  ? "Couldn't load, tap to retry"
                  : "Play voice note"}
            </button>
          ))}
      </div>
    </li>
  );
}

/**
 * Chat-style note composer: rounded input bar, circular mic that morphs
 * into a recording pill, circular send. Recording flow: mic tap ->
 * MediaRecorder (pill with pulsing dot + elapsed) -> stop ->
 * /api/transcribe -> transcript lands in the input, still editable, with
 * the audio attached. Send inserts the note with body + audio_path.
 */
export function NoteComposer({
  matchId,
  pointId,
  userId,
  placeholder,
  onNoteAdded,
}: {
  matchId: string;
  pointId: string | null;
  userId: string;
  placeholder: string;
  onNoteAdded: (note: Note) => void;
}) {
  const [body, setBody] = useState("");
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recState, setRecState] = useState<
    "idle" | "recording" | "transcribing"
  >("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const stopTracks = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => stopTracks, [stopTracks]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    if (blob.size > MAX_AUDIO_BYTES) {
      setError("That recording is too long. Keep voice notes under 10 MB.");
      setRecState("idle");
      return;
    }
    setRecState("transcribing");
    try {
      const form = new FormData();
      const ext = blob.type.includes("mp4") ? "note.mp4" : "note.webm";
      form.append("audio", blob, ext);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.audio_path) {
        throw new Error(data?.error ?? "transcribe failed");
      }
      const transcript = String(data.transcript ?? "").trim();
      if (transcript) {
        setBody((prev) =>
          prev.trim() ? `${prev.trimEnd()}\n${transcript}` : transcript
        );
      }
      setAudioPath(String(data.audio_path));
    } catch {
      setError("Couldn't transcribe that. Try again.");
    } finally {
      setRecState("idle");
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined") {
      setError("Voice notes aren't supported in this browser.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked. Check browser permissions.");
      return;
    }
    const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(
      (t) => MediaRecorder.isTypeSupported(t)
    );
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      if (blob.size === 0) {
        setError("Nothing was recorded. Try again.");
        setRecState("idle");
        return;
      }
      void transcribe(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setElapsed(0);
    setRecState("recording");
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }, [transcribe]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const save = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed && !audioPath) return;
    setPosting(true);
    setError(null);
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("notes")
      .insert({
        match_id: matchId,
        point_id: pointId,
        author_id: userId,
        body: trimmed,
        audio_path: audioPath,
      })
      .select()
      .single();
    setPosting(false);
    if (dbError || !data) {
      setError("Couldn't save the note. Try again.");
      return;
    }
    setBody("");
    setAudioPath(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    onNoteAdded(data as Note);
  }, [body, audioPath, matchId, pointId, userId, onNoteAdded]);

  const busy = recState !== "idle";
  const canSend = !posting && !busy && (body.trim().length > 0 || !!audioPath);

  return (
    <div>
      {audioPath && recState === "idle" && (
        <p className="mb-2 flex items-center gap-2 text-xs text-cyan-glow">
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path strokeLinecap="round" d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
          Voice note attached
          <button
            type="button"
            onClick={() => setAudioPath(null)}
            className="text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
          >
            remove
          </button>
        </p>
      )}

      {recState === "recording" ? (
        /* the input bar morphs into the recording pill */
        <div className="flex h-11 items-center gap-3 rounded-full border border-red-500/50 bg-red-500/10 pl-4 pr-1.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="text-sm tabular-nums text-red-300">
            {fmtElapsed(elapsed)}
          </span>
          <span className="flex-1 truncate text-xs text-zinc-500">
            Recording…
          </span>
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Stop recording"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="7" y="7" width="10" height="10" rx="1.5" />
            </svg>
          </button>
        </div>
      ) : recState === "transcribing" ? (
        <div className="flex h-11 items-center gap-3 rounded-full border border-edge bg-ink/60 px-4">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-glow" />
          <span className="text-sm text-zinc-400">Transcribing…</span>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex min-h-[44px] flex-1 items-center rounded-3xl border border-edge bg-ink/60 px-4 py-2 transition-colors focus-within:border-cyan-glow/50">
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                autoGrow();
              }}
              rows={1}
              placeholder={placeholder}
              className="max-h-40 w-full resize-none bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </div>
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={posting}
            aria-label="Record a voice note"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/40 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path strokeLinecap="round" d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void save()}
            aria-label="Send note"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cyan-glow text-ink transition-opacity disabled:opacity-40"
          >
            {posting ? (
              <span className="text-sm font-semibold">…</span>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 19V5m0 0-6 6m6-6 6 6"
                />
              </svg>
            )}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
