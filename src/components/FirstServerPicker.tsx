"use client";

import type { MatchServer } from "@/app/match/[id]/serving";

/**
 * "Who served first?" on the upload forms.
 *
 * The whole match's serve rotation hangs off this one answer, and the
 * uploader knows it at upload time better than anything downstream can
 * work it out. Asking here retires the question everywhere else: the
 * match page's banner, the scoring pad's setup sheet and the iOS
 * takeover are all gated on first_server being null.
 *
 * Optional by construction. Nothing is selected until it is tapped, and
 * tapping the selected choice again clears it, so an unanswered form
 * leaves first_server null and the existing guess still runs. A wrong
 * answer is worse than no answer: it suppresses both the fallback and
 * the prompt that would have fixed it.
 */
export function FirstServerPicker({
  value,
  opponentName,
  onPick,
}: {
  value: MatchServer | null;
  opponentName: string;
  onPick: (next: MatchServer | null) => void;
}) {
  // Their real name when the form has one. "Your opponent" rather than
  // "Them": the other button says "You", and the pair should read as two
  // people rather than as a pronoun drill.
  const them = opponentName.trim() || "Your opponent";
  const options: { value: MatchServer; label: string }[] = [
    { value: "user", label: "You" },
    { value: "opponent", label: them },
  ];
  return (
    <div className="rounded-xl border border-edge bg-surface-2/40 p-3.5">
      <p className="text-sm text-zinc-200">Who served first?</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(on ? null : o.value)}
              className={`min-w-0 rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                on
                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span className="block truncate">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
