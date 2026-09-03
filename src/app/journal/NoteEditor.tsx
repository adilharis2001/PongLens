"use client";

import { useEffect, useRef, useState } from "react";
import type { Lesson, LessonTakeaways } from "@/lib/types";
import { AutoTextarea } from "@/components/AutoTextarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";

/**
 * Editing an entry means editing the NOTE, not the speech-to-text it came
 * from. Before this, Edit reopened the capture sheet on the raw
 * transcript and saving re-distilled everything, so fixing one wrong
 * bullet meant rewriting forty minutes of transcription and regenerating
 * all sixteen points. Nobody did that, so wrong points stood forever.
 *
 * One rule decides which of the two shapes below you get:
 *
 *   takeaways != null  the note is what you edit, and the transcript sits
 *                      underneath, readable and copyable but not editable
 *   takeaways == null  there is no note, so the words ARE the note and a
 *                      single field holds them
 *
 * Two things the capture sheet has are deliberately absent from both
 * shapes. The Practice/Lesson tab, because an entry's kind is decided
 * when it is written and flipping it here would quietly rewrite what the
 * entry is. And "Improve with AI", because improving reads the
 * transcript, and editing a note never changes the transcript.
 */

/** Stable React keys for lines whose text is being edited: two themes can
 *  legitimately be called the same thing mid-typing, and a point's own
 *  words cannot key it while they are still changing. */
let uid = 0;
const nextId = () => `n${++uid}`;

interface DraftPoint {
  id: string;
  text: string;
}
interface DraftTheme {
  id: string;
  name: string;
  points: DraftPoint[];
}

function draftThemes(takeaways: LessonTakeaways | null): DraftTheme[] {
  return (takeaways?.themes ?? []).map((t) => ({
    id: nextId(),
    name: t.name,
    points: t.points.map((p) => ({ id: nextId(), text: p })),
  }));
}

/** What "unsaved changes" compares. Blank points and emptied themes are
 *  dropped first, because they are exactly what the save drops too: an
 *  added-then-abandoned empty line is not a change worth guarding. */
function snapshot(
  title: string,
  coach: string,
  themes: DraftTheme[],
  words: string
) {
  return JSON.stringify({
    title: title.trim(),
    coach: coach.trim(),
    words: words.trim(),
    themes: themes
      .map((t) => ({
        name: t.name.trim(),
        points: t.points.map((p) => p.text.trim()).filter(Boolean),
      }))
      .filter((t) => t.points.length > 0),
  });
}

/**
 * The box that is actually on screen, tracked through the keyboard.
 *
 * A phone keyboard does not shrink 100dvh — dvh follows the browser's own
 * chrome, not the keys — so a full-height sheet keeps laying itself out
 * behind the keyboard and Save ends up under it. visualViewport is the
 * only thing that reports what is visible, and offsetTop matters as much
 * as height, because iOS scrolls the visual viewport inside the layout
 * one rather than resizing it. Where the API is missing, dvh is close.
 */
function useVisibleBox(active: boolean) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!active || !vv) {
      setBox(null);
      return;
    }
    const read = () => setBox({ top: vv.offsetTop, height: vv.height });
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    // window resize as well, and not as belt and braces: a pinned height
    // that stops tracking is worse than never pinning one, and there are
    // browsers (and remote-controlled ones) that resize the page without
    // firing visualViewport's own event.
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, [active]);
  return box;
}

const FIELD =
  "w-full rounded-xl border border-edge bg-surface-2/50 px-3.5 py-2.5 " +
  "text-[15px] text-zinc-100 placeholder:text-zinc-500 outline-none " +
  "focus:border-cyan-glow/60";
const LABEL =
  "block text-xs font-semibold uppercase tracking-wider text-zinc-500";

export function NoteEditor({
  lesson,
  coachNames = [],
  onClose,
  onSaved,
}: {
  /** The entry being edited. Null closes the overlay. */
  lesson: Lesson | null;
  /** Coaches already named in this journal, for the suggestion list. */
  coachNames?: string[];
  onClose: () => void;
  /** The saved row, for the feed to repaint without a reload. */
  onSaved: (lesson: Lesson) => void;
}) {
  const open = lesson !== null;
  const hasNote = lesson?.takeaways != null;

  const [title, setTitle] = useState("");
  const [themes, setThemes] = useState<DraftTheme[]>([]);
  const [words, setWords] = useState("");
  const [coachName, setCoachName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A line added by hand should be ready to type into. The id is claimed
  // here and spent by the field's ref the moment it mounts.
  const [focusId, setFocusId] = useState<string | null>(null);

  const box = useVisibleBox(open);
  const originalRef = useRef<string>("");
  const seededFor = useRef<string | null>(null);

  // Seed once per entry, so a repaint of the feed underneath can never
  // reach in and clobber half-typed words.
  useEffect(() => {
    if (!lesson) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current === lesson.id) return;
    seededFor.current = lesson.id;
    const t = lesson.takeaways;
    const seedThemes = draftThemes(t);
    setTitle(t?.title ?? "");
    setThemes(seedThemes);
    setWords(t ? "" : lesson.transcript);
    setCoachName(lesson.coach_name ?? "");
    setError(null);
    setShowTranscript(false);
    setFocusId(null);
    originalRef.current = snapshot(
      t?.title ?? "",
      lesson.coach_name ?? "",
      seedThemes,
      t ? "" : lesson.transcript
    );
  }, [lesson]);

  const dirty =
    open && snapshot(title, coachName, themes, words) !== originalRef.current;

  const attemptClose = () => {
    if (saving) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  // Escape closes, through the same guard as the X and the backdrop. No
  // dependency list: attemptClose reads state that changes every
  // keystroke, and a stale closure here would discard work silently.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirmDiscard) return;
      e.stopPropagation();
      attemptClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  // The sheet covers the page on a phone; the feed behind it must not
  // scroll under the finger.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const copyTranscript = async () => {
    if (!lesson) return;
    try {
      await navigator.clipboard.writeText(lesson.transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // the text is expanded and selectable either way
    }
  };

  const setThemeName = (id: string, name: string) =>
    setThemes((ts) => ts.map((t) => (t.id === id ? { ...t, name } : t)));

  const setPointText = (themeId: string, pointId: string, text: string) =>
    setThemes((ts) =>
      ts.map((t) =>
        t.id === themeId
          ? {
              ...t,
              points: t.points.map((p) =>
                p.id === pointId ? { ...p, text } : p
              ),
            }
          : t
      )
    );

  const addPoint = (themeId: string) => {
    const id = nextId();
    setThemes((ts) =>
      ts.map((t) =>
        t.id === themeId ? { ...t, points: [...t.points, { id, text: "" }] } : t
      )
    );
    setFocusId(id);
  };

  const removePoint = (themeId: string, pointId: string) =>
    setThemes((ts) =>
      ts.map((t) =>
        t.id === themeId
          ? { ...t, points: t.points.filter((p) => p.id !== pointId) }
          : t
      )
    );

  const addTheme = () => {
    const id = nextId();
    setThemes((ts) => [
      ...ts,
      { id, name: "", points: [{ id: nextId(), text: "" }] },
    ]);
    setFocusId(id);
  };

  const removeTheme = (themeId: string) =>
    setThemes((ts) => ts.filter((t) => t.id !== themeId));

  const save = async () => {
    if (!lesson || saving) return;
    // Only a lesson has a coach, and this overlay cannot change an
    // entry's kind, so practice entries never carry a name through.
    const coach =
      lesson.kind === "lesson" ? coachName.trim().slice(0, 80) || null : null;

    if (hasNote) {
      const cleaned = themes
        .map((t) => ({
          name: t.name.trim(),
          points: t.points.map((p) => p.text.trim()).filter(Boolean),
        }))
        .filter((t) => t.points.length > 0);
      // Said here as well as on the server, so a note emptied by hand
      // fails the moment Save is pressed rather than after a round trip.
      if (cleaned.length === 0) {
        setError("A note needs at least one point.");
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/lesson/note", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonId: lesson.id,
            takeaways: { title: title.trim(), themes: cleaned },
            coachName: coach,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.takeaways) {
          setError(
            data?.error ?? "Couldn't save it. Your changes are still here."
          );
          return;
        }
        // The card is repainted from the stored note, not from the draft:
        // the server trims and caps, and a card drawn from the draft
        // would disagree with the row until the next reload.
        onSaved({
          ...lesson,
          takeaways: data.takeaways as LessonTakeaways,
          coach_name: coach,
        });
        onClose();
      } catch {
        setError("Couldn't save it. Your changes are still here.");
      } finally {
        setSaving(false);
      }
      return;
    }

    const transcript = words.trim();
    if (!transcript) {
      setError("An entry needs some words.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          transcript,
          kind: lesson.kind,
          coachName: coach,
          // This entry has no note, so its words are the note. Improving
          // is a choice made when an entry is written; offering it again
          // here would grow points out of an edit nobody asked to
          // improve.
          summarize: false,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        setError(
          data?.error ?? "Couldn't save it. Your changes are still here."
        );
        return;
      }
      onSaved({
        ...lesson,
        transcript,
        takeaways: null,
        status: "ready",
        coach_name: coach,
      });
      onClose();
    } catch {
      setError("Couldn't save it. Your changes are still here.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {open && lesson && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={hasNote ? "Edit note" : "Edit entry"}
          className="fixed inset-x-0 top-0 z-[70] flex h-[100dvh] items-stretch justify-center sm:items-center sm:p-6"
          style={box ? { top: box.top, height: box.height } : undefined}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={attemptClose}
            className="absolute inset-0 cursor-default bg-ink/70 backdrop-blur-sm"
          />
          {/* Full bleed on a phone, a centred card from sm up. Nothing
              above the card is transformed: ConfirmDialog positions
              itself against the screen, and a transform anywhere in its
              ancestry would redefine "the screen" as this card. */}
          <div className="relative flex h-full w-full flex-col bg-surface sm:h-auto sm:max-h-full sm:w-full sm:max-w-2xl sm:rounded-2xl sm:border sm:border-edge sm:shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-zinc-100">
                {hasNote ? "Edit note" : "Edit entry"}
              </h2>
              <button
                type="button"
                onClick={attemptClose}
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

            {/* The one scrolling region. At 393x660 with the keyboard up
                about 360 pixels are visible, and the header and the action
                bar take 114 of them, so everything else lives in here and
                the focused field has to be able to reach the middle of
                it. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              {lesson.kind === "lesson" && (
                <div className="mb-4">
                  <label className={LABEL} htmlFor="note-coach">
                    Coach
                  </label>
                  <input
                    id="note-coach"
                    type="text"
                    value={coachName}
                    onChange={(e) => setCoachName(e.target.value.slice(0, 80))}
                    list="note-coach-names"
                    maxLength={80}
                    placeholder="Who taught it?"
                    autoComplete="off"
                    className={`mt-2 ${FIELD}`}
                  />
                  {coachNames.length > 0 && (
                    <datalist id="note-coach-names">
                      {coachNames.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                  )}
                </div>
              )}

              {hasNote ? (
                <>
                  <label className={LABEL} htmlFor="note-title">
                    Title
                  </label>
                  <input
                    id="note-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                    maxLength={120}
                    placeholder="What the session was about"
                    className={`mt-2 ${FIELD} text-base font-semibold`}
                  />

                  <div className="mt-5 space-y-3">
                    {themes.map((theme) => (
                      <div
                        key={theme.id}
                        className="rounded-2xl border border-edge bg-surface-2/40 p-3.5"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={theme.name}
                            onChange={(e) =>
                              setThemeName(theme.id, e.target.value.slice(0, 80))
                            }
                            maxLength={80}
                            placeholder="Heading"
                            aria-label="Heading name"
                            ref={(el) => {
                              if (el && focusId === theme.id) {
                                el.focus();
                                setFocusId(null);
                              }
                            }}
                            className="min-w-0 flex-1 border-b border-transparent bg-transparent pb-1 text-sm font-semibold text-cyan-glow outline-none placeholder:font-normal placeholder:text-zinc-500 focus:border-cyan-glow/50"
                          />
                          {/* Attached to the theme it removes, so it stays
                              a text button rather than a pill. */}
                          <button
                            type="button"
                            onClick={() => removeTheme(theme.id)}
                            className="shrink-0 text-sm font-medium text-zinc-400 transition-colors hover:text-amber-300"
                          >
                            Remove
                          </button>
                        </div>

                        <ul className="mt-2.5 space-y-1.5">
                          {theme.points.map((point) => (
                            <li key={point.id} className="flex gap-2">
                              {/* Measured onto the centre of the field's
                                  first line so a point reads as the same
                                  bullet the card shows: 6px of padding, a
                                  1px border and half of a 26px line on a
                                  phone, where the global input rule lifts
                                  the text to 16px to stop iOS zooming. */}
                              <span className="mt-[18px] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                              <AutoTextarea
                                value={point.text}
                                onChange={(e) =>
                                  setPointText(
                                    theme.id,
                                    point.id,
                                    e.target.value.slice(0, 400)
                                  )
                                }
                                rows={1}
                                maxLength={400}
                                placeholder="One short reminder"
                                aria-label="Point"
                                ref={(el) => {
                                  if (el && focusId === point.id) {
                                    el.focus();
                                    setFocusId(null);
                                  }
                                }}
                                className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[15px] text-zinc-200 outline-none hover:border-edge focus:border-cyan-glow/50 focus:bg-surface-2/60"
                              />
                              <button
                                type="button"
                                onClick={() => removePoint(theme.id, point.id)}
                                aria-label="Remove this point"
                                title="Remove this point"
                                className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-surface-2 hover:text-amber-300"
                              >
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
                                    d="M6 6l12 12M18 6L6 18"
                                  />
                                </svg>
                              </button>
                            </li>
                          ))}
                        </ul>

                        <button
                          type="button"
                          onClick={() => addPoint(theme.id)}
                          className="mt-2.5 rounded-full border border-edge px-3.5 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                        >
                          Add a point
                        </button>
                      </div>
                    ))}
                  </div>

                  {themes.length === 0 && (
                    <p className="mt-5 text-sm text-zinc-400">No headings yet.</p>
                  )}

                  <button
                    type="button"
                    onClick={addTheme}
                    className="mt-3 w-full rounded-full border border-dashed border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                  >
                    Add a heading
                  </button>

                  {/* The transcript is here to check the note against, and
                      that is all it does here. It is the source the note
                      was read from, and rewriting it is a different job
                      with different consequences. */}
                  <div className="mt-5 rounded-2xl border border-edge bg-surface-2/25">
                    <div className="flex items-center gap-3 px-3.5 py-2.5">
                      <button
                        type="button"
                        onClick={() => setShowTranscript((v) => !v)}
                        aria-expanded={showTranscript}
                        className="flex items-center gap-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-3.5 w-3.5 transition-transform ${
                            showTranscript ? "rotate-90" : ""
                          }`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m9 6 6 6-6 6"
                          />
                        </svg>
                        Original transcript
                      </button>
                      <span className="text-xs uppercase tracking-wider text-zinc-500">
                        Read only
                      </span>
                      {showTranscript && (
                        <button
                          type="button"
                          onClick={() => void copyTranscript()}
                          className="ml-auto text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      )}
                    </div>
                    {showTranscript && (
                      <p className="max-h-56 select-text overflow-y-auto whitespace-pre-wrap border-t border-edge px-3.5 py-3 text-[13px] leading-relaxed text-zinc-400">
                        {lesson.transcript}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <label className={LABEL} htmlFor="note-words">
                    Your words
                  </label>
                  <AutoTextarea
                    id="note-words"
                    value={words}
                    onChange={(e) => setWords(e.target.value)}
                    rows={6}
                    placeholder={
                      lesson.kind === "lesson"
                        ? "What your coach gave you"
                        : "What you worked on"
                    }
                    className={`mt-2 ${FIELD} leading-relaxed`}
                  />
                </>
              )}
            </div>

            <div className="shrink-0 border-t border-edge px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              {error && <p className="mb-2.5 text-sm text-red-400">{error}</p>}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={attemptClose}
                  disabled={saving}
                  className="rounded-full border border-edge px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="glow-cta flex-1 rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Outside the sheet on purpose: it positions itself against the
          screen, and nesting it under the card would tie it to whatever
          the card is doing. */}
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        confirmLabel="Discard"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
