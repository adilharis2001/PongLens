"use client";

import { useRef, useState } from "react";

export interface FocusPoint {
  id: string;
  label: string;
  retired_at: string | null;
  created_at: string;
}

/** What happened to an "add cue" attempt — the card and the lesson
 *  takeaway buttons both report it the same way. */
export type AddCueResult = "added" | "dup" | "full";

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * The pinned "Working on" card: the 3-5 cues a player is actively fixing
 * — the list every paper table-tennis journal keeps on its first page.
 * Ticking a cue retires it (kept, not deleted): the retired set is the
 * History — the quiet record of what became habit — with a way back for
 * anything that crept in again. State lives in NotesFeed so lesson
 * takeaways can file cues here too.
 *
 * The card renders in BOTH states: empty, it introduces itself with one
 * line and a proper Add button instead of hiding behind a grey text
 * link a new account never notices. The cue input takes dictation
 * through the same /api/transcribe flow as notes (transcript lands in
 * the input, still editable; the audio is not kept for cues).
 */
export function WorkingOn({
  cues,
  onAdd,
  onRetire,
  onRestore,
}: {
  /** every cue, active and retired, oldest first */
  cues: FocusPoint[];
  onAdd: (label: string) => Promise<AddCueResult>;
  onRetire: (id: string) => void;
  onRestore: (id: string) => Promise<AddCueResult>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [rec, setRec] = useState<"idle" | "recording" | "writing">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const active = cues.filter((c) => !c.retired_at);
  const retired = cues
    .filter((c) => c.retired_at)
    .sort((a, b) => (b.retired_at ?? "").localeCompare(a.retired_at ?? ""));

  const add = async () => {
    const label = draft.trim().slice(0, 120);
    if (!label) return;
    setDraft("");
    setAdding(false);
    await onAdd(label);
  };

  const stopTracks = () => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stopTracks();
        setRec("writing");
        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          const form = new FormData();
          form.append("audio", blob, "cue.webm");
          form.append("persist", "false");
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });
          const data = res.ok ? await res.json() : null;
          const words = String(data?.transcript ?? "").trim();
          if (words) {
            setDraft((d) =>
              (d.trim() ? `${d.trim()} ${words}` : words).slice(0, 120)
            );
            inputRef.current?.focus();
          }
        } finally {
          setRec("idle");
        }
      };
      recorder.start();
      setRec("recording");
    } catch {
      setRec("idle");
    }
  };

  const addPill = !adding && active.length < 5 && (
    <button
      type="button"
      onClick={() => setAdding(true)}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-edge px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
      >
        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
      </svg>
      Add
    </button>
  );

  const historyToggle = retired.length > 0 && (
    <button
      type="button"
      onClick={() => setShowHistory((v) => !v)}
      className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
    >
      {showHistory ? "Hide history" : `History (${retired.length})`}
    </button>
  );

  const historyList = showHistory && (
    <ul className="mt-2 space-y-1.5">
      {retired.map((c) => (
        <li key={c.id} className="flex items-start gap-2.5">
          <svg
            viewBox="0 0 24 24"
            className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow/50"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
          </svg>
          <span className="min-w-0 flex-1 text-sm leading-snug text-zinc-500">
            {c.label}
            <span className="ml-1.5 text-[11px] text-zinc-600">
              {c.retired_at ? shortDate(c.retired_at) : ""}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void onRestore(c.id)}
            className="shrink-0 text-[11px] font-medium text-zinc-600 transition-colors hover:text-cyan-glow"
          >
            Restore
          </button>
        </li>
      ))}
    </ul>
  );

  const addRow = adding && (
    <div className="mt-2 flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void add();
          if (e.key === "Escape" && rec === "idle") {
            setDraft("");
            setAdding(false);
          }
        }}
        placeholder="One cue, e.g. racket up between strokes"
        maxLength={120}
        className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-2/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
      />
      <button
        type="button"
        onClick={() =>
          rec === "recording" ? recorderRef.current?.stop() : startRecording()
        }
        disabled={rec === "writing"}
        aria-label={rec === "recording" ? "Stop recording" : "Speak the cue"}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
          rec === "recording"
            ? "animate-pulse border-red-400/70 text-red-400"
            : "border-edge text-zinc-300 hover:border-cyan-glow/50 hover:text-white"
        } disabled:opacity-50`}
      >
        {rec === "writing" ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
        ) : rec === "recording" ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm0 0v3m-4 3h8m-9-9a5 5 0 0 0 10 0"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={() => void add()}
        disabled={!draft.trim() || rec !== "idle"}
        className="shrink-0 rounded-full bg-cyan-glow px-3.5 py-1.5 text-xs font-semibold text-ink transition-opacity disabled:opacity-40"
      >
        Add
      </button>
    </div>
  );

  return (
    <div className="mb-4 rounded-2xl border border-cyan-glow/25 bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-glow/80">
          Working on
        </p>
        {addPill}
      </div>
      {active.length === 0 && !adding ? (
        <p className="mt-2 text-sm text-zinc-500">
          The cues you&apos;re fixing right now.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {active.map((p) => (
            <li key={p.id} className="group flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => onRetire(p.id)}
                aria-label={`Done: ${p.label}`}
                title="Got it — retire this cue"
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-zinc-600 text-zinc-600 transition-colors hover:border-cyan-glow/60 hover:text-cyan-glow"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                </svg>
              </button>
              <span className="text-sm leading-snug text-zinc-200">
                {p.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {addRow}
      {retired.length > 0 && <div className="mt-2.5">{historyToggle}</div>}
      {historyList}
    </div>
  );
}
