"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AutoTextarea } from "@/components/AutoTextarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
 *
 * authorName comes from match_note_authors(); the generic "Coach" /
 * "Player" is only a fallback for an author we couldn't resolve, since
 * two coaches on one match are indistinguishable under the generic label.
 */
export function NoteItem({
  note,
  matchId,
  ownerId,
  viewerId,
  authorName,
  clamp = false,
  onDeleted,
}: {
  note: Note;
  matchId: string;
  ownerId: string;
  viewerId: string;
  authorName?: string | null;
  /** Over video (the note sheet, the analysis panel): cut a long note to
   *  four lines so the thread can't push the footage off the screen. */
  clamp?: boolean;
  /** Tells the surface holding this note's row that it is gone, so a
   *  wrapper card (the journal feed's) comes down with it. */
  onDeleted?: (id: string) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // Own-note edit/delete. Local-first: a removed note renders null and an
  // edited body overrides, so every surface using NoteItem gets both
  // without threading callbacks (the DB is the truth on next load).
  const [removed, setRemoved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [localBody, setLocalBody] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const saveEdit = useCallback(async () => {
    const body = draft.trim();
    setEditing(false);
    if (body === (localBody ?? note.body)) return;
    setLocalBody(body);
    const supabase = createClient();
    const { error } = await supabase
      .from("notes")
      .update({ body })
      .eq("id", note.id);
    if (error) setLocalBody(null);
  }, [draft, localBody, note.body, note.id]);

  const deleteNote = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const supabase = createClient();
    // .select() confirms a row actually went away — a delete a policy
    // blocks comes back 200 with no error and zero rows.
    const { data, error } = await supabase
      .from("notes")
      .delete()
      .eq("id", note.id)
      .select("id");
    setDeleting(false);
    if (error || !data || data.length === 0) {
      setDeleteError("Couldn't delete this note. Try again.");
      return;
    }
    setConfirmDel(false);
    setRemoved(true);
    onDeleted?.(note.id);
  }, [deleting, note.id, onDeleted]);

  const isCoachNote = note.author_id !== ownerId;
  const isMine = note.author_id === viewerId;
  // The match owner can clear any note off their own match; everyone else
  // only deletes what they wrote. Editing stays the author's alone.
  const canDelete = isMine || viewerId === ownerId;
  const authorLabel = isMine
    ? "You"
    : (authorName ?? "").trim() || (isCoachNote ? "Coach" : "Player");

  // Annotated frame (040): signed on mount — an image should just be
  // there, unlike audio which waits for a play tap.
  useEffect(() => {
    if (!note.image_path) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, noteId: note.id, image: true }),
        });
        const data = res.ok ? await res.json() : null;
        if (!cancelled && data?.url) setImageUrl(data.url);
      } catch {
        // the note still reads fine as text
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, note.id, note.image_path]);

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

  if (removed) return null;
  const displayBody = localBody ?? note.body;

  return (
    <li
      className={`border-l-2 py-0.5 pl-3.5 ${
        isCoachNote ? "border-amber-400/50" : "border-cyan-glow/40"
      }`}
    >
      <p className="flex items-baseline gap-2 text-[11px] text-zinc-500">
        <span>
          <span
            className={`font-semibold ${
              isCoachNote ? "text-amber-300" : "text-zinc-400"
            }`}
          >
            {authorLabel}
          </span>{" "}
          · {timeShort(note.created_at)}
        </span>
        {canDelete && !editing && (
          <span className="flex gap-3">
            {isMine && displayBody && (
              <button
                type="button"
                onClick={() => {
                  setDraft(displayBody);
                  setEditing(true);
                }}
                className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setConfirmDel(true);
              }}
              className="text-sm font-medium text-zinc-400 transition-colors hover:text-red-400"
            >
              Delete
            </button>
          </span>
        )}
      </p>
      <ConfirmDialog
        open={confirmDel}
        title="Delete this note?"
        confirmLabel="Delete"
        busy={deleting}
        error={deleteError}
        onCancel={() => setConfirmDel(false)}
        onConfirm={() => void deleteNote()}
      />
      <div>
        {editing ? (
          <div className="mt-1">
            <AutoTextarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              className="min-h-16 rounded-lg border border-edge bg-surface-2/40 px-2.5 py-2 text-sm text-zinc-100 focus:border-cyan-glow/60 focus:outline-none"
            />
            <div className="mt-1 flex gap-3 text-sm font-medium">
              <button
                type="button"
                onClick={() => void saveEdit()}
                className="text-cyan-glow"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-zinc-400"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : displayBody ? (
          <p
            className={`mt-0.5 whitespace-pre-wrap text-sm text-zinc-200 ${
              clamp ? "line-clamp-4" : ""
            }`}
          >
            {displayBody}
          </p>
        ) : null}
        {note.image_path &&
          (imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="Annotated video frame"
              loading="lazy"
              decoding="async"
              className="mt-2 w-full max-w-md rounded-lg border border-edge"
            />
          ) : (
            <div className="mt-2 aspect-video w-full max-w-md animate-pulse rounded-lg border border-edge bg-surface-2/40" />
          ))}
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
/**
 * The notes already on a point, over video (the watch player's note sheet,
 * the Keep-score analysis panel).
 *
 * Writing a note without seeing the thread means a coach and a player can
 * say the same thing twice and never know. But this sits on top of the
 * footage, so it stays small: the two most recent notes, each cut to four
 * lines, and a link that opens the rest. Same items, same attribution
 * colours, as the point view's thread.
 */
export function PointNoteThread({
  notes,
  matchId,
  ownerId,
  viewerId,
  authorNames,
}: {
  notes: Note[];
  matchId: string;
  ownerId: string;
  viewerId: string;
  authorNames: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (notes.length === 0) return null;
  const PREVIEW = 2;
  const hidden = notes.length - PREVIEW;
  const shown = expanded ? notes : notes.slice(0, PREVIEW);
  return (
    <div className="mb-3">
      <ul className="space-y-2.5">
        {shown.map((n) => (
          <NoteItem
            key={n.id}
            note={n}
            matchId={matchId}
            ownerId={ownerId}
            viewerId={viewerId}
            authorName={authorNames.get(n.author_id)}
            clamp={!expanded}
          />
        ))}
      </ul>
      {/* Offer the expand when there are notes you cannot see AND when the
          ones you can see are cut off — a clamped note with no way to read
          the rest is worse than not showing it. */}
      {(hidden > 0 || notes.some((n) => (n.body ?? "").length > 180)) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-semibold text-cyan-glow transition-colors hover:text-white"
        >
          {expanded
            ? "Show less"
            : hidden > 0
              ? `Show ${hidden} more note${hidden === 1 ? "" : "s"}`
              : "Show full note"}
        </button>
      )}
    </div>
  );
}

export function NoteComposer({
  matchId,
  pointId,
  userId,
  placeholder,
  imagePath = null,
  onNoteAdded,
}: {
  matchId: string;
  pointId: string | null;
  userId: string;
  placeholder: string;
  /** Annotated frame already uploaded (040) — saved with the note. The
   *  caller renders its own preview; this only writes the column. */
  imagePath?: string | null;
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
    if (!trimmed && !audioPath && !imagePath) return;
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
        image_path: imagePath,
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
  }, [body, audioPath, imagePath, matchId, pointId, userId, onNoteAdded]);

  const busy = recState !== "idle";
  const canSend =
    !posting && !busy && (body.trim().length > 0 || !!audioPath || !!imagePath);

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
            <AutoTextarea
              variant="composer"
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={1}
              placeholder={placeholder}
              className="bg-transparent text-sm text-zinc-200 outline-none"
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
