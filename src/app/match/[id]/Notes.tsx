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

/** One note card. Player notes are cyan, coach notes amber with a tag. */
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
  const authorLabel =
    note.author_id === viewerId ? "You" : isCoachNote ? "Coach" : "Player";

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
      className={`rounded-xl border p-3 ${
        isCoachNote
          ? "border-amber-400/40 bg-amber-400/5"
          : "border-cyan-glow/30 bg-surface-2/40"
      }`}
    >
      <p className="flex items-center gap-2 text-xs text-zinc-500">
        {isCoachNote && (
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            Coach
          </span>
        )}
        <span>
          {authorLabel} · {timeShort(note.created_at)}
        </span>
      </p>
      {note.body && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">
          {note.body}
        </p>
      )}
      {note.audio_path &&
        (audioUrl ? (
          <audio
            src={audioUrl}
            controls
            autoPlay
            className="mt-2 h-9 w-full"
          />
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
    </li>
  );
}

/**
 * Note composer: text plus a voice note button. Recording flow:
 * mic tap -> MediaRecorder (pulsing red dot + elapsed) -> stop ->
 * /api/transcribe -> transcript lands in the text field, still editable,
 * with the audio attached. Save inserts the note with body + audio_path.
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

  const stopTracks = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => stopTracks, [stopTracks]);

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
    onNoteAdded(data as Note);
  }, [body, audioPath, matchId, pointId, userId, onNoteAdded]);

  const busy = recState !== "idle";

  return (
    <div>
      {recState === "recording" && (
        <p className="mb-2 flex items-center gap-2 text-sm text-red-300">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          Recording {fmtElapsed(elapsed)} — tap the mic to stop
        </p>
      )}
      {recState === "transcribing" && (
        <p className="mb-2 text-sm text-zinc-400">Transcribing…</p>
      )}
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
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder={placeholder}
          className="min-h-[44px] flex-1 resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600"
        />
        <button
          type="button"
          onClick={() =>
            recState === "recording" ? stopRecording() : void startRecording()
          }
          disabled={recState === "transcribing" || posting}
          aria-label={
            recState === "recording"
              ? "Stop recording"
              : "Record a voice note"
          }
          className={`rounded-lg border p-2.5 transition-colors disabled:opacity-50 ${
            recState === "recording"
              ? "border-red-500/60 bg-red-500/15 text-red-400"
              : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/50 hover:text-white"
          }`}
        >
          {recState === "recording" ? (
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
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
          )}
        </button>
        <button
          type="button"
          disabled={posting || busy || (body.trim().length === 0 && !audioPath)}
          onClick={() => void save()}
          className="rounded-lg bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {posting ? "…" : "Save"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
