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
  coachNames = [],
  createTag,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Owner's tag vocabulary, recent-first (shared with points). */
  vocab: Tag[];
  /** Coach names already used on this journal, for the suggestion list.
   *  One tap keeps the spelling identical across lessons, which is what
   *  makes "everything Jonathan told me" a reliable question. */
  coachNames?: string[];
  /** Find-or-create in the shared vocabulary. */
  createTag: (label: string) => Promise<Tag | null>;
  onSaved: (lesson: Lesson, tags: Tag[]) => void;
}) {
  const [kind, setKind] = useState<"practice" | "lesson">("practice");
  const [text, setText] = useState("");
  const [coachName, setCoachName] = useState("");
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [summarize, setSummarize] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recState, setRecState] = useState<"idle" | "recording" | "writing">(
    "idle"
  );
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  // Scan pages: photos of a paper journal, read into editable text and
  // never stored. Attach photo: one moderated image kept on the entry.
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [scanState, setScanState] = useState<"idle" | "reading">("idle");
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{
    preview: string;
    path: string | null;
    checking: boolean;
  } | null>(null);

  /** Downscale to <=1600px JPEG: smaller uploads, cheaper vision calls. */
  const shrink = (file: File): Promise<Blob> =>
    new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });

  const scanPages = async (files: File[]) => {
    if (files.length === 0 || scanState === "reading") return;
    setScanState("reading");
    setScanNote(null);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files.slice(0, 6)) {
        form.append("pages", await shrink(f), "page.jpg");
      }
      const res = await fetch("/api/journal-ocr", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setScanNote(data?.error ?? "Couldn't read those pages. Try again.");
        return;
      }
      const pages: ({ text?: string } | null)[] = data?.pages ?? [];
      const texts = pages
        .map((pg) => (pg && "text" in pg ? String(pg.text ?? "").trim() : ""))
        .filter(Boolean);
      const skipped = pages.length - texts.length;
      if (texts.length > 0) {
        setText((t) =>
          t.trim()
            ? `${t.trim()}\n\n${texts.join("\n\n")}`
            : texts.join("\n\n")
        );
      }
      setScanNote(
        texts.length === 0
          ? "Those photos didn't look like notes pages."
          : skipped > 0
            ? `Read ${texts.length} page${texts.length === 1 ? "" : "s"}; ${skipped} didn't look like a notes page.`
            : null
      );
    } finally {
      setScanState("idle");
    }
  };

  const attachPhoto = async (file: File) => {
    if (photo?.checking) return;
    const preview = URL.createObjectURL(file);
    setPhoto({ preview, path: null, checking: true });
    setError(null);
    try {
      const form = new FormData();
      form.append("image", await shrink(file), "photo.jpg");
      const res = await fetch("/api/entry-image", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.image_path) {
        URL.revokeObjectURL(preview);
        setPhoto(null);
        setError(data?.error ?? "Couldn't add that photo.");
        return;
      }
      setPhoto({ preview, path: data.image_path, checking: false });
    } catch {
      URL.revokeObjectURL(preview);
      setPhoto(null);
      setError("Couldn't add that photo.");
    }
  };

  const stopTracks = () => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
  };

  const discardPhoto = (candidate = photo) => {
    if (!candidate) return;
    URL.revokeObjectURL(candidate.preview);
    if (candidate.path) {
      void fetch("/api/entry-image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: candidate.path }),
        keepalive: true,
      });
    }
    setPhoto(null);
  };

  const closeEditor = () => {
    discardRecordingRef.current = true;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    } else {
      stopTracks();
    }
    discardPhoto();
    onClose();
  };

  const startRecording = async () => {
    setError(null);
    discardRecordingRef.current = false;
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
        if (discardRecordingRef.current) {
          setRecState("idle");
          return;
        }
        setRecState("writing");
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
        body: JSON.stringify({
          transcript,
          kind,
          summarize,
          imagePath: photo?.path ?? null,
          // Only a lesson has a coach. Switching back to Practice after
          // typing a name must not smuggle it through.
          coachName: kind === "lesson" ? coachName.trim() || null : null,
        }),
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
          coach_name: kind === "lesson" ? coachName.trim() || null : null,
          image_path: photo?.path ?? null,
          created_at: new Date().toISOString(),
        } as Lesson,
        selectedTags
      );
      setText("");
      setCoachName("");
      setSelectedTags([]);
      if (photo) URL.revokeObjectURL(photo.preview);
      setPhoto(null);
      setScanNote(null);
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
        onClick={closeEditor}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-2xl border border-edge bg-surface p-5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-2rem)] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {kindChip("practice", "Practice")}
            {kindChip("lesson", "Lesson")}
          </div>
          <button
            type="button"
            onClick={closeEditor}
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

        {/* Who taught it. Optional, and only on a lesson — practice is
            your own. The suggestion list is every coach already in this
            journal, so the second lesson with someone is one tap and the
            spelling stays identical, which is what makes asking about
            them later work at all. */}
        {kind === "lesson" && (
          <div className="mt-3">
            <input
              type="text"
              value={coachName}
              onChange={(e) => setCoachName(e.target.value.slice(0, 80))}
              list="journal-coach-names"
              maxLength={80}
              placeholder="Who taught it?"
              aria-label="Coach name"
              autoComplete="off"
              className="w-full rounded-xl border border-edge bg-surface-2/40 px-3.5 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
            />
            {coachNames.length > 0 && (
              <datalist id="journal-coach-names">
                {coachNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            )}
          </div>
        )}

        <div className="relative mt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              kind === "lesson"
                ? "Paste the transcript, or start writing"
                : "What did you work on today?"
            }
            aria-label="Entry text"
            className="min-h-44 w-full resize-y rounded-xl border border-edge bg-surface-2/40 px-3.5 py-3 pb-11 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
          />
          {/* the mic lives where the words land */}
          <button
            type="button"
            onClick={recState === "recording" ? stopRecording : startRecording}
            disabled={recState === "writing"}
            aria-label={
              recState === "recording" ? "Stop recording" : "Speak instead"
            }
            className={`absolute bottom-3 right-2.5 flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
              recState === "recording"
                ? "border-red-400/60 bg-red-500/10 text-red-300"
                : "border-edge bg-surface text-zinc-300 hover:border-cyan-glow/50 hover:text-white"
            } disabled:opacity-50`}
          >
            {recState === "recording" ? (
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
        </div>

        {/* photos: scanned pages become editable text (and are not
            kept); an attached photo is checked, then stored with the
            entry. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            ref={scanInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              void scanPages(files);
            }}
          />
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void attachPhoto(file);
            }}
          />
          <button
            type="button"
            onClick={() => scanInputRef.current?.click()}
            disabled={scanState === "reading"}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-edge px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-cyan-glow/40 hover:text-zinc-300 disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 7h3l2-2h6l2 2h3v12H4V7Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
              />
            </svg>
            {scanState === "reading" ? "Reading pages…" : "Scan pages"}
          </button>
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={!!photo}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-edge px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-cyan-glow/40 hover:text-zinc-300 disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="4" y="5" width="16" height="14" rx="2" />
              <path strokeLinecap="round" d="m6 15 4-4 4 4 2-2 2 2" />
              <circle cx="9.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
            </svg>
            Add photo
          </button>
        </div>
        {scanState === "reading" && (
          <p className="mt-2 animate-pulse text-xs text-zinc-400">
            Reading your pages into text. The photos aren&apos;t kept.
          </p>
        )}
        {scanNote && scanState === "idle" && (
          <p className="mt-2 text-xs text-amber-300/90">{scanNote}</p>
        )}
        {photo && (
          <div className="mt-2.5 flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.preview}
              alt="Photo to attach"
              className={`h-14 w-14 rounded-lg border border-edge object-cover ${
                photo.checking ? "opacity-50" : ""
              }`}
            />
            {photo.checking ? (
              <span className="animate-pulse text-xs text-zinc-400">
                Checking the photo…
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  discardPhoto(photo);
                }}
                className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Remove
              </button>
            )}
          </div>
        )}

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

        <div className="mt-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={summarize}
              onChange={(e) => setSummarize(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-cyan-glow,#22d3ee)]"
            />
            Condense and summarize
          </label>
        </div>
        {recState === "writing" && (
          <p className="mt-2 animate-pulse text-xs text-zinc-400">
            Writing that down…
          </p>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || text.trim() === "" || photo?.checking === true}
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
