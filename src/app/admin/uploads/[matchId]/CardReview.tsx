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
  /** How many cards carry it. Only read to warn before deleting one that
   *  is still in use; absent on a theme just created in this session,
   *  which by definition is on no cards but the one that made it. */
  uses?: number;
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
  onThemeDeleted,
  compact = false,
}: {
  pointId: string;
  note: string;
  themeIds: string[];
  vocabulary: Theme[];
  onNoteChange: (pointId: string, body: string) => void;
  onThemeToggle: (pointId: string, themeId: string, on: boolean) => void;
  onThemeCreated: (theme: Theme) => void;
  /** Drops the theme from the vocabulary and from every card that carried
   *  it. The caller owns both lists, so it has to do the forgetting. */
  onThemeDeleted: (themeId: string) => void;
  /** Set when this sits in the column beside the footage. Drops the top
   *  margin it needs when stacked, and a row of the note box, because the
   *  column has to hold the map and the readings as well. */
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(note);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  // Open, and it stays however it was last left. Reviewing a match means
  // tagging nearly every card, so a picker that closed itself on each one
  // charged a click per card for a panel that was wanted every time.
  const [picking, setPicking] = useState(true);
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Following the selection means the box shows THIS card's note; without
  // it, moving down the list would carry the previous card's text along and
  // the next keystroke would save it onto the wrong point.
  useEffect(() => {
    setDraft(note);
    setStatus("idle");
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

  /**
   * Drop a theme from the vocabulary for good.
   *
   * Deleting cascades to every card carrying it, so a theme in use asks
   * first and names the number — the point of this control is clearing out
   * pills that were a bad idea, and a bad idea has no cards on it. An
   * unused one goes on the tap, because stopping to confirm nothing is
   * how a tidy-up turns into a chore.
   */
  const forget = async (theme: Theme) => {
    const uses = theme.uses ?? 0;
    if (
      uses > 0 &&
      !window.confirm(
        `"${theme.label}" is on ${uses} card${uses === 1 ? "" : "s"}. ` +
          `Deleting it takes it off ${uses === 1 ? "that card" : "those cards"} too.`
      )
    ) {
      return;
    }
    const { error } = await createClient().rpc("admin_theme_delete", {
      p_theme_id: theme.id,
    });
    if (!error) onThemeDeleted(theme.id);
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
    <div
      className={
        compact
          ? "rounded-2xl border border-edge bg-surface p-3"
          : "mt-3 rounded-2xl border border-edge bg-surface p-4"
      }
    >
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
          {/* Capped, and it scrolls itself. The vocabulary only grows —
              sixteen themes today, forty by Christmas — and an uncapped
              list would push the note box further off the screen every
              week. The order above does the real work: what gets reached
              for is at the top, so the scroll is for the tail nobody
              wants. Uncapped when this is stacked down the page, where
              height is free. */}
          <div
            className={
              compact
                ? "mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto pr-1"
                : "mt-2 flex flex-wrap gap-1.5"
            }
          >
            {/* Two controls in one pill: the label applies the theme to this
                card, the × forgets the theme everywhere. They cannot be
                confused for the applied chips above, which carry their own
                × for "take it off this card" — a theme already on the card
                is not in this list at all. The × is grey until hovered and
                then amber, the colour this codebase uses for destructive. */}
            {matching.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center rounded-full border border-edge transition-colors hover:border-cyan-glow/40"
              >
                <button
                  type="button"
                  onClick={() => toggle(t)}
                  className="rounded-l-full py-1 pl-3 pr-1 text-xs text-zinc-300"
                >
                  {t.label}
                </button>
                <button
                  type="button"
                  onClick={() => void forget(t)}
                  aria-label={`Delete the theme ${t.label}`}
                  title={
                    (t.uses ?? 0) > 0
                      ? `Delete "${t.label}" everywhere — it is on ${t.uses} card${t.uses === 1 ? "" : "s"}`
                      : `Delete "${t.label}" — it is on no cards`
                  }
                  className="rounded-r-full py-1 pl-1 pr-2.5 text-xs leading-none text-zinc-600 transition-colors hover:text-amber-300"
                >
                  ×
                </button>
              </span>
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
        rows={compact ? 2 : 3}
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
