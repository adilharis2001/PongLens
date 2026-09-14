"use client";

/**
 * The app's switch: a cyan-tinted track with a round thumb, the same
 * control on the export sheet, the share sheet and wherever else a sheet
 * asks a yes-or-no. It lived inside the export bar; the share sheet had
 * a plain checkbox for the same question, which is the kind of drift
 * this file exists to stop (2026-09-14).
 */
export function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  /** The accessible name; the visible words sit beside the control. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        on ? "border-cyan-glow/60 bg-cyan-glow/30" : "border-edge bg-surface-2"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-[1.125rem] w-[1.125rem] rounded-full transition-all ${
          on ? "left-5 bg-cyan-glow" : "left-0.5 bg-zinc-500"
        }`}
      />
    </button>
  );
}
