"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Lesson, Tag } from "@/lib/types";
import { PointTags } from "@/app/match/[id]/Tags";
import { DictateMic, useDictation } from "@/components/dictation";
import {
  AddPhotoButton,
  PhotoPreview,
  shrinkImage,
  useEntryPhoto,
} from "@/components/entryPhoto";
import { CoachPicker } from "./CoachPicker";
import type { PlayerCoach } from "@/lib/coaches/playerCoaches";

/**
 * The Journal's capture sheet. Two kinds of entry — a lesson (what a
 * coach gave you) or practice (your own drills and reflections) — and
 * three ways in: write it, speak it (recorded here, transcribed by the
 * same route voice notes use), or paste it. One quiet choice, "Improve
 * with AI", default on: the text comes back as clear grouped points with
 * the original kept; off stores every word exactly as written.
 *
 * Match notes are NOT created here — they are born inside matches, where
 * the footage is.
 *
 * This sheet only ever creates. Editing an existing entry is NoteEditor's
 * job, because what you want to fix afterwards is the note, not the
 * speech-to-text underneath it. That also puts the kind tab and the
 * condense choice where they belong: both are decisions about an entry
 * being written, and neither can be re-asked later without rewriting what
 * the entry already is.
 *
 * The microphone, the photo and the improve switch are the same three
 * pieces the coach's entry composer uses, shared rather than copied: they
 * drifted apart once already, with the coach side improving every entry
 * silently while this one asked.
 */
export function JournalEditor({
  open,
  onClose,
  userId,
  vocab,
  coaches = [],
  createCoach,
  createTag,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Owner's tag vocabulary, recent-first (shared with points). */
  vocab: Tag[];
  /** The player's own coaches (164). A pick, not a typed name: two
   *  spellings of one person is the defect this replaced. */
  coaches?: PlayerCoach[];
  /** Find-or-create a coach by name. */
  createCoach: (name: string) => Promise<PlayerCoach | null>;
  /** Find-or-create in the shared vocabulary. */
  createTag: (label: string) => Promise<Tag | null>;
  onSaved: (lesson: Lesson, tags: Tag[]) => void;
}) {
  const [kind, setKind] = useState<"practice" | "lesson">("practice");
  const [text, setText] = useState("");
  const [coachRefId, setCoachRefId] = useState<string | null>(null);
  const [shareWithCoach, setShareWithCoach] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [summarize, setSummarize] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Scan pages: photos of a paper journal, read into editable text and
  // never stored. Attach photo: one moderated image kept on the entry.
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [scanState, setScanState] = useState<"idle" | "reading">("idle");
  const [scanNote, setScanNote] = useState<string | null>(null);

  const append = useCallback((words: string) => {
    setText((t) => (t.trim() ? `${t.trim()}\n\n${words}` : words));
  }, []);
  const dictation = useDictation({ onText: append, onError: setError });
  const {
    photo,
    attach: attachPhoto,
    discard: discardPhoto,
    release: releasePhoto,
  } = useEntryPhoto(setError);

  // Start blank on every open, so the next entry never opens on the last
  // one. Keyed on the open transition rather than run on every render, or
  // typing would be wiped mid-session.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    setKind("practice");
    setText("");
    setCoachRefId(null);
    setShareWithCoach(false);
    setSummarize(true);
  }, [open]);

  const scanPages = async (files: File[]) => {
    if (files.length === 0 || scanState === "reading") return;
    setScanState("reading");
    setScanNote(null);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files.slice(0, 6)) {
        form.append("pages", await shrinkImage(f), "page.jpg");
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

  const closeEditor = () => {
    dictation.cancel();
    discardPhoto();
    onClose();
  };

  const chosenCoach = coaches.find((c) => c.id === coachRefId) ?? null;

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
          // picking one must not smuggle it through.
          coachRefId: kind === "lesson" ? coachRefId : null,
          shareWithCoach: kind === "lesson" && shareWithCoach,
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
          coach_name: kind === "lesson" ? (chosenCoach?.display_name ?? null) : null,
          coach_ref_id: kind === "lesson" ? coachRefId : null,
          shared_with_coach_at:
            kind === "lesson" && shareWithCoach && chosenCoach
              ? new Date().toISOString()
              : null,
          image_path: photo?.path ?? null,
          created_at: new Date().toISOString(),
        } as Lesson,
        selectedTags
      );
      setText("");
      setCoachRefId(null);
      setShareWithCoach(false);
      setSelectedTags([]);
      releasePhoto();
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
            your own. A pick rather than a typed name (164), so the second
            lesson with someone is the same coach rather than a second
            spelling of them, and so the entry can reach their account.
            The share answer sits in here with it: one moment, one
            decision. */}
        {kind === "lesson" && (
          <CoachPicker
            coaches={coaches}
            value={coachRefId}
            share={shareWithCoach}
            disabled={saving}
            onChange={(id, share) => {
              setCoachRefId(id);
              setShareWithCoach(share);
            }}
            onCreate={createCoach}
          />
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
          <DictateMic
            state={dictation.state}
            onStart={() => void dictation.start()}
            onStop={dictation.stop}
          />
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
          <AddPhotoButton
            disabled={!!photo}
            onPick={(file) => void attachPhoto(file)}
          />
        </div>
        {scanState === "reading" && (
          <p className="mt-2 animate-pulse text-xs text-zinc-400">
            Reading your pages into text. The photos aren&apos;t kept.
          </p>
        )}
        {scanNote && scanState === "idle" && (
          <p className="mt-2 text-xs text-amber-300/90">{scanNote}</p>
        )}
        {photo && <PhotoPreview photo={photo} onRemove={discardPhoto} />}

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
          <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={summarize}
              onChange={(e) => setSummarize(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-cyan-glow,#22d3ee)]"
            />
            <span>
              Improve with AI
              <span className="mt-0.5 block text-xs text-zinc-500">
                Your rough notes become clear, simple points. You can edit
                them afterwards.
              </span>
            </span>
          </label>
        </div>
        {dictation.state === "writing" && (
          <p className="mt-2 animate-pulse text-xs text-zinc-400">
            Writing that down…
          </p>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={
            saving ||
            text.trim() === "" ||
            photo?.checking === true ||
            dictation.state !== "idle"
          }
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
