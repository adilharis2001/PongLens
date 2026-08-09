"use client";

import { useCallback, useState } from "react";

import { AutoTextarea } from "@/components/AutoTextarea";
import { DictateButton } from "@/components/DictateButton";

/**
 * "Tell me about it" in one field: type it, or say it.
 *
 * Shared by the offering drafter and the profile drafter so the two
 * cannot drift, and because both got the same two things wrong on a
 * phone. The mic used to sit beside the field, which on a 393px screen
 * left about four words a line, and the field used the growing variant,
 * so a coach who said much of anything pushed the buttons off the bottom
 * of the screen and could not reach them.
 *
 * So: the field is full width and capped (composer grows to 40dvh then
 * scrolls inside itself), and the mic sits underneath on its own row.
 * That row keeps its height whether it holds a 36px circle or the much
 * wider recording pill, so starting to speak moves nothing.
 */
export function BriefField({
  value,
  onChange,
  onError,
  placeholder,
  micLabel,
  hint = "or say it out loud",
  maxLength = 2000,
}: {
  value: string;
  onChange: (v: string) => void;
  onError: (message: string) => void;
  placeholder: string;
  micLabel: string;
  hint?: string;
  maxLength?: number;
}) {
  const [dictating, setDictating] = useState(false);

  const append = useCallback(
    (t: string) => onChange((value ? `${value} ${t}` : t).slice(0, maxLength)),
    [onChange, value, maxLength],
  );

  return (
    <>
      <AutoTextarea
        variant="composer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={maxLength}
        placeholder={placeholder}
        // Tighter than the composer default. A 40dvh field plus a heading,
        // a mic row, two buttons and a footnote does not leave 660px of
        // phone anywhere to put the button you are meant to press.
        style={{ maxHeight: "min(30dvh, 15rem)" }}
        className="mt-3 rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
      />
      <div className="mt-2 flex min-h-9 items-center gap-3">
        <DictateButton
          label={micLabel}
          onTranscript={append}
          onError={onError}
          onBusyChange={setDictating}
        />
        {!dictating && <span className="text-sm text-zinc-500">{hint}</span>}
      </div>
    </>
  );
}
