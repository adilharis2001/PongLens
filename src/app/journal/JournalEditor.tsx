"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Lesson, Tag } from "@/lib/types";
import { PointTags } from "@/app/match/[id]/Tags";

/**
 * The Journal's capture sheet. Two kinds of entry — a lesson (what a
 * coach gave you) or practice (your own drills and reflections) — and
 * three ways in: write it, speak it (recorded here, transcribed by the
 * same route voice notes use), or paste it. One quiet choice, "Condense
 * and summarize", default on: long text becomes grouped takeaways with
 * the original kept; off stores every word exactly as written.
 *
 * Match notes are NOT created here — they are born inside matches, where
 * the footage is.
 */
export function JournalEditor({
  open,
  onClose,
  userId,
  vocab,
  createTag,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Owner's tag vocabulary, recent-first (shared with points). */
  vocab: Tag[];
  /** Find-or-create in the shared vocabulary. */
  createTag: (label: string) => Promise<Tag | null>;
  onSaved: (lesson: Lesson, tags: Tag[]) => void;
}) {
  const [kind, setKind] = useState<"practice" | "lesson">("practice");
  const [text, setText] = useState("");
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [summarize, setSummarize] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recState, setRecState] = useState<"idle" | "recording" | "writing">(
    "idle"
  );
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopTracks = () => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stopTracks();
        setRecState("writing");
        try {
          const blob = new Blob(chunksRef.current, {
            type: rec.mimeType || "audio/webm",
          });
          const form = new FormData();
          form.append("audio", blob, "journal.webm");
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });
          const data = res.ok ? await res.json() : null;
          const words = String(data?.transcript ?? "").trim();
          if (!words) throw new Error("empty");
          setText((t) => (t.trim() ? `${t.trim()}\n\n${words}` : words));
        } catch {
          setError("Couldn't hear that clearly. Try again or type it.");
        } finally {
          setRecState("idle");
        }
      };
      rec.start();
      setRecState("recording");
    } catch {
      setError("Microphone unavailable.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const save = async () => {
    const transcript = text.trim();
    if (!transcript || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, kind, summarize }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.id) throw new Error("no id");
      // Tags chosen while composing attach once the entry exists. A
      // failure here loses only the tags, never the words.
      if (selectedTags.length > 0) {
        const supabase = createClient();
        await supabase.from("entry_tags").insert(
          selectedTags.map((t) => ({
            lesson_id: data.id,
            tag_id: t.id,
            created_by: userId,
          }))
        );
      }
      onSaved(
        {
          id: data.id,
          user_id: userId,
          match_id: null,
          transcript,
          takeaways: data.takeaways ?? null,
          status: data.status === "ready" ? "ready" : "failed",
          kind,
          created_at: new Date().toISOString(),
        } as Lesson,
        selectedTags
      );
      setText("");
      setSelectedTags([]);
      onClose();
    } catch {
      setError("Couldn't save it. Your words are still here — try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const kindChip = (value: "practice" | "lesson", label: string) => (
    <button
      type="button"
      onClick={() => setKind(value)}
      aria-pressed={kind === value}
      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
        kind === value
          ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
          : "border-edge text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {kindChip("practice", "Practice")}
            {kindChip("lesson", "Lesson")}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-sm text-zinc-400">
          {kind === "lesson"
            ? "What your coach gave you. Type it, speak it, or paste it."
            : "Drills, reflections, anything worth keeping."}
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            kind === "lesson"
              ? "Paste the transcript, or start writing"
              : "What did you work on today?"
          }
          aria-label="Entry text"
          className="mt-3 min-h-44 w-full resize-y rounded-xl border border-edge bg-surface-2/40 px-3.5 py-3 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
        />

        {/* Tags travel with the entry — same picker as a point's. */}
        <div className="mt-3">
          <PointTags
            pointLabel="New entry"
            tags={selectedTags}
            vocab={vocab}
            onToggle={(t) =>
              setSelectedTags((s) =>
                s.some((x) => x.id === t.id)
                  ? s.filter((x) => x.id !== t.id)
                  : [...s, t]
              )
            }
            onCreate={(label) =>
              void createTag(label).then(
                (t) =>
                  t &&
                  setSelectedTags((s) =>
                    s.some((x) => x.id === t.id) ? s : [...s, t]
                  )
              )
            }
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={summarize}
              onChange={(e) => setSummarize(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-cyan-glow,#22d3ee)]"
            />
            Condense and summarize
          </label>
          <button
            type="button"
            onClick={recState === "recording" ? stopRecording : startRecording}
            disabled={recState === "writing"}
            aria-label={
              recState === "recording" ? "Stop recording" : "Speak instead"
            }
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
              recState === "recording"
                ? "border-red-400/60 bg-red-500/10 text-red-300"
                : "border-edge text-zinc-300 hover:border-cyan-glow/50 hover:text-white"
            } disabled:opacity-50`}
          >
            {recState === "recording" ? (
              <span className="h-3 w-3 animate-pulse rounded-sm bg-red-400" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-4.5 w-4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path
                  strokeLinecap="round"
                  d="M5 11a7 7 0 0 0 14 0M12 18v3"
                />
              </svg>
            )}
          </button>
        </div>
        {recState === "writing" && (
          <p className="mt-2 animate-pulse text-xs text-zinc-400">
            Writing that down…
          </p>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || text.trim() === ""}
          className="glow-cta mt-3 block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink disabled:opacity-60"
        >
          {saving
            ? summarize
              ? "Reading it through…"
              : "Saving…"
            : "Save entry"}
        </button>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
