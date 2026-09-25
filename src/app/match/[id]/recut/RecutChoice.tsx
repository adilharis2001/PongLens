"use client";

import type { RecutChoice as Choice, RecutChoiceView } from "./recutView";

/**
 * The dress of one choose-one cell: a rounded field lit in the accent when
 * chosen. Shared with the two ways' pick-one group (WayChoice), so the two
 * choices in the product read as one pattern.
 */
export function choiceCellClass(on: boolean, enabled: boolean): string {
  return `rounded-xl border px-4 py-3.5 transition-colors ${
    !enabled
      ? "cursor-not-allowed border-edge/60 bg-ink/20 opacity-50"
      : on
        ? "cursor-pointer border-cyan-glow/70 bg-cyan-glow/10"
        : "cursor-pointer border-edge bg-ink/40 hover:border-zinc-600"
  }`;
}

/**
 * The radio mark inside a choose-one cell: filled with a tick when on. It
 * sits on the left, its middle on the title's line (the cell aligns to the
 * top and the 18px mark drops 1px into the title's 20px line), as on iOS.
 */
export function RadioMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${
        on ? "border-cyan-glow bg-cyan-glow" : "border-zinc-600"
      }`}
    >
      {on && (
        <svg viewBox="0 0 24 24" className="h-3 w-3 text-ink" fill="none" stroke="currentColor" strokeWidth="3">
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5 9-10" />
        </svg>
      )}
    </span>
  );
}

/**
 * The last step of cutting a processed match again, either way: replace
 * this match, or keep it and add the new cut as a new match. Two rows, one
 * selected, Keep by default. The app's choose-one cells (the same dress as
 * the Processing request form's): a rounded field lit in the accent when
 * chosen, with a radio mark so both read as a choice before either is
 * picked. Radio on the left, the title, any lines under it: the same
 * layout as the two ways above it in More options (WayChoice), so the
 * sheet's two choices read as one. The native radio is for the keyboard
 * and the screen reader; the cell is the control.
 *
 * Nothing else is said here: no price, nothing about scores, no word for
 * what a "version" is (Cut again contract, "Never").
 */
export function RecutChoice({
  name,
  view,
  onChange,
  disabled = false,
}: {
  /** Distinguishes the radio group when two are on one page. */
  name: string;
  view: RecutChoiceView;
  onChange: (choice: Choice) => void;
  disabled?: boolean;
}) {
  const cell = (
    value: Choice,
    label: string,
    enabled: boolean,
    lines: string[],
  ) => {
    const on = view.selected === value;
    return (
      <label
        key={value}
        className={`flex items-start gap-3 focus-within:border-cyan-glow ${choiceCellClass(on, enabled)}`}
      >
        <input
          type="radio"
          name={name}
          value={value}
          checked={on}
          disabled={!enabled || disabled}
          onChange={() => onChange(value)}
          className="sr-only"
        />
        <RadioMark on={on} />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={`text-sm font-semibold ${on ? "text-cyan-glow" : "text-zinc-100"}`}>
            {label}
          </span>
          {lines.map((line) => (
            <span key={line} className="text-sm text-zinc-400">
              {line}
            </span>
          ))}
        </span>
      </label>
    );
  };

  return (
    <fieldset disabled={disabled} className="grid gap-2.5">
      <legend className="sr-only">Replace this match or keep it</legend>
      {cell(
        "replace",
        "Replace this match",
        view.replaceEnabled,
        view.replaceEnabled ? view.replaceLines : view.replaceNote ? [view.replaceNote] : [],
      )}
      {cell("keep", "Keep this match and add a new one", true, [])}
    </fieldset>
  );
}
