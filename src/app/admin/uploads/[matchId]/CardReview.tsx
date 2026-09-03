"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The operator's own note and themes on one card (150).
 *
 * Separate from the player's tags and notes on purpose, in the database and
 * here. Those belong to the person who played the match and are shown to
 * them and their coach; these are internal, span every account, and would
 * be a strange thing for a customer to find on their own point.
 *
 * Saving is optimistic and debounced. Reviewing nine hundred cards means
 * typing in one box and moving on, so nothing here has a Save button and
 * nothing blocks the next card. A failed write says so and keeps the text.
 */

export interface Theme {
  id: string;
  label: string;
}

/** Offered greyed until first used, exactly as the player's tag picker
 *  does it — a vocabulary suggests itself but is only created on real use,
 *  so an unused suggestion never clutters the grouping. */
const STARTER_THEMES = [
  "First bounce missed",
  "Ball track breaks up",
  "Wrong table",
  "Card starts late",
  "Card ends early",
  "Two points in one card",
  "Serve is really there",
  "Rightly refused",
];

const SAVE_DEBOUNCE_MS = 700;

export function CardReview({
  pointId,
  note,
  themeIds,
  vocabulary,
  onNoteChange,
  onThemeToggle,
  onThemeCreated,
}: {
  pointId: string;
  note: string;
  themeIds: string[];
  vocabulary: Theme[];
  onNoteChange: (pointId: string, body: string) => void;
  onThemeToggle: (pointId: string, themeId: string, on: boolean) => void;
  onThemeCreated: (theme: Theme) => void;
}) {
  const [draft, setDraft] = useState(note);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Following the selection means the box shows THIS card's note; without
  // it, moving down the list would carry the previous card's text along and
  // the next keystroke would save it onto the wrong point.
  useEffect(() => {
    setDraft(note);
    setStatus("idle");
    setPicking(false);
  }, [pointId, note]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const save = (body: string) => {
    setStatus("saving");
    void createClient()
      .rpc("admin_point_note_set", { p_point_id: pointId, p_body: body })
      .then(({ error }) => {
        if (error) {
          setStatus("error");
          return;
        }
        setStatus("saved");
        onNoteChange(pointId, body);
      });
  };

  const onType = (value: string) => {
    setDraft(value);
    setStatus("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(value), SAVE_DEBOUNCE_MS);
  };

  const toggle = (theme: Theme) => {
    const on = !themeIds.includes(theme.id);
    onThemeToggle(pointId, theme.id, on);
    void createClient()
      .rpc("admin_point_theme_set", {
        p_point_id: pointId,
        p_theme_id: theme.id,
        p_on: on,
      })
      .then(({ error }) => {
        // Put it back rather than leaving the chip lying about the row.
        if (error) onThemeToggle(pointId, theme.id, !on);
      });
  };

  const create = async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const { data, error } = await createClient().rpc("admin_theme_create", {
      p_label: trimmed,
    });
    if (error || !data) return;
    const theme = data as Theme;
    onThemeCreated(theme);
    setQuery("");
    if (!themeIds.includes(theme.id)) toggle(theme);
  };

  const applied = vocabulary.filter((t) => themeIds.includes(t.id));
  const q = query.trim().toLowerCase();
  const matching = vocabulary.filter(
    (t) => !themeIds.includes(t.id) && (!q || t.label.toLowerCase().includes(q))
  );
  const starters = STARTER_THEMES.filter(
    (label) =>
      !vocabulary.some((t) => t.label.toLowerCase() === label.toLowerCase()) &&
      (!q || label.toLowerCase().includes(q))
  );
  const exact = vocabulary.some((t) => t.label.toLowerCase() === q);

  return (
    <div className="mt-3 rounded-2xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {applied.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => toggle(t)}
            title="Remove this theme"
            className="rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-3 py-1 text-xs text-cyan-glow transition-colors hover:border-cyan-glow"
          >
            {t.label} ×
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          {picking ? "Done" : applied.length ? "Themes" : "Add a theme"}
        </button>
      </div>

      {picking && (
        <div className="mt-3 rounded-xl border border-edge bg-surface-2/50 p-3">
          <input
            type="text"
            value={query}
            autoFocus
            placeholder="Find or create a theme"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim() && !exact) {
                e.preventDefault();
                void create(query);
              }
            }}
            className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {matching.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t)}
                className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-300 transition-colors hover:border-cyan-glow/40"
              >
                {t.label}
              </button>
            ))}
            {starters.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => void create(label)}
                title="Not used yet — tapping creates it"
                className="rounded-full border border-dashed border-edge px-3 py-1 text-xs text-zinc-600 transition-colors hover:text-zinc-300"
              >
                {label}
              </button>
            ))}
            {q && !exact && (
              <button
                type="button"
                onClick={() => void create(query)}
                className="rounded-full border border-cyan-glow/50 px-3 py-1 text-xs text-cyan-glow"
              >
                Create &ldquo;{query.trim()}&rdquo;
              </button>
            )}
            {matching.length === 0 && starters.length === 0 && !q && (
              <p className="text-xs text-zinc-600">
                No themes yet. Type one and press Enter.
              </p>
            )}
          </div>
        </div>
      )}

      <textarea
        value={draft}
        onChange={(e) => onType(e.target.value)}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          if (draft !== note) save(draft);
        }}
        rows={3}
        placeholder="What did you notice about this card?"
        className="mt-3 w-full resize-y rounded-xl border border-edge bg-surface-2/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50"
      />
      <p className="mt-1 h-4 text-xs">
        {status === "saving" && <span className="text-zinc-600">Saving…</span>}
        {status === "saved" && <span className="text-zinc-600">Saved</span>}
        {status === "error" && (
          <span className="text-amber-300">
            That did not save. The text is still here — try again.
          </span>
        )}
      </p>
    </div>
  );
}
