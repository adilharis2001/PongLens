"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Account -> Player profile: the same fields onboarding collects
 * (handedness, grip, level, rubber types and models, playing style),
 * editable any time — rubbers change, games evolve. Rubbers and style are
 * ONLY here now: onboarding stopped asking them so a first upload is four
 * questions away rather than eight. Every change saves on its
 * own with the app's quiet "Saved" flash; the text inputs save on blur.
 */

export interface PlayerProfile {
  handedness: "right" | "left" | null;
  grip: "shakehand" | "penhold" | null;
  fh_rubber: string | null;
  bh_rubber: string | null;
  fh_rubber_name: string | null;
  bh_rubber_name: string | null;
  style: "attacker" | "all_round" | "defender" | null;
  /** Self-reported playing level (115). Words, not a rating. */
  level:
    | "beginner"
    | "intermediate"
    | "advanced"
    | "club"
    | "regional"
    | "national"
    | "international"
    | null;
}

const EMPTY: PlayerProfile = {
  handedness: null,
  grip: null,
  fh_rubber: null,
  bh_rubber: null,
  fh_rubber_name: null,
  bh_rubber_name: null,
  style: null,
  level: null,
};

const RUBBERS = [
  { value: "inverted", label: "Inverted" },
  { value: "short_pips", label: "Short pips" },
  { value: "long_pips", label: "Long pips" },
  { value: "anti", label: "Anti-spin" },
];

function PillGroup<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onPick: (v: T | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(selected ? null : o.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              selected
                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PlayerProfileSection({
  userId,
  initial,
}: {
  userId: string;
  initial: PlayerProfile | null;
}) {
  const [profile, setProfile] = useState<PlayerProfile>(initial ?? EMPTY);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const save = async (next: PlayerProfile) => {
    setProfile(next);
    const supabase = createClient();
    const { error } = await supabase.from("player_profiles").upsert(
      {
        user_id: userId,
        ...next,
        fh_rubber_name: next.fh_rubber_name?.trim() || null,
        bh_rubber_name: next.bh_rubber_name?.trim() || null,
        setup_done_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (!error) {
      setFlash(true);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(false), 1500);
    }
  };

  const row = (label: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="shrink-0 text-sm font-medium text-zinc-200">
        {label}
      </span>
      {control}
    </div>
  );

  const modelInput = (wing: "fh_rubber_name" | "bh_rubber_name") => (
    <input
      type="text"
      maxLength={80}
      defaultValue={profile[wing] ?? ""}
      onBlur={(e) => {
        const v = e.target.value.trim() || null;
        if (v !== profile[wing]) void save({ ...profile, [wing]: v });
      }}
      placeholder="Model (optional)"
      className="w-full rounded-lg border border-edge bg-surface-2/40 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/60 focus:outline-none sm:w-44"
    />
  );

  return (
    <div className="relative divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
      {flash && (
        <span className="absolute right-4 top-3 text-[11px] font-medium text-cyan-glow">
          Saved
        </span>
      )}
      {row(
        "Handedness",
        <PillGroup
          value={profile.handedness}
          options={[
            { value: "right", label: "Right" },
            { value: "left", label: "Left" },
          ]}
          onPick={(v) => void save({ ...profile, handedness: v })}
        />
      )}
      {/* Asked in onboarding now; it changes over a career, so it is
          editable here like everything else. */}
      {row(
        "Level",
        <PillGroup
          value={profile.level}
          options={[
            { value: "beginner", label: "Beginner" },
            { value: "intermediate", label: "Intermediate" },
            { value: "advanced", label: "Advanced" },
            { value: "club", label: "Club" },
            { value: "regional", label: "Regional" },
            { value: "national", label: "National" },
            { value: "international", label: "International" },
          ]}
          onPick={(v) => void save({ ...profile, level: v })}
        />
      )}
      {row(
        "Grip",
        <PillGroup
          value={profile.grip}
          options={[
            { value: "shakehand", label: "Shakehand" },
            { value: "penhold", label: "Penhold" },
          ]}
          onPick={(v) => void save({ ...profile, grip: v })}
        />
      )}
      {row(
        "Forehand rubber",
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <PillGroup
            value={profile.fh_rubber}
            options={RUBBERS}
            onPick={(v) => void save({ ...profile, fh_rubber: v })}
          />
          {modelInput("fh_rubber_name")}
        </div>
      )}
      {row(
        "Backhand rubber",
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <PillGroup
            value={profile.bh_rubber}
            options={RUBBERS}
            onPick={(v) => void save({ ...profile, bh_rubber: v })}
          />
          {modelInput("bh_rubber_name")}
        </div>
      )}
      {row(
        "Playing style",
        <PillGroup
          value={profile.style}
          options={[
            { value: "attacker", label: "Attacker" },
            { value: "all_round", label: "All-round" },
            { value: "defender", label: "Defender" },
          ]}
          onPick={(v) => void save({ ...profile, style: v })}
        />
      )}
    </div>
  );
}
