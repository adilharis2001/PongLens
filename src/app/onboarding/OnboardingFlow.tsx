"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { displayNameError, normalizeDisplayName } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/client";

/**
 * First-login setup, one idea per screen, everything after the name
 * skippable:
 *
 *   name  — only when the account has none (email sign-ins; Google
 *           arrives with one).
 *   play  — handedness + grip, four large tap targets.
 *   gear  — rubber type per wing, then the standard three-family
 *           playing style (attacker / all-round / defender). Long pips
 *           or anti softly suggests the defensive family, never forces.
 *
 * Coaches (arriving through a coach invite) answer only the name: the
 * profile row is written all-null on their way through, and the same
 * fields stay editable in Account for coaches who also play.
 *
 * Finishing OR skipping writes the player_profiles row — the row's
 * presence is what tells the middleware this was offered.
 */

type Handedness = "right" | "left";
type Grip = "shakehand" | "penhold";
type Rubber = "inverted" | "short_pips" | "long_pips" | "anti";
type Style = "attacker" | "all_round" | "defender";

const RUBBERS: { value: Rubber; label: string }[] = [
  { value: "inverted", label: "Inverted" },
  { value: "short_pips", label: "Short pips" },
  { value: "long_pips", label: "Long pips" },
  { value: "anti", label: "Anti-spin" },
];

const STYLES: { value: Style; label: string; blurb: string }[] = [
  {
    value: "attacker",
    label: "Attacker",
    blurb: "You look for the first strong ball and take it.",
  },
  {
    value: "all_round",
    label: "All-round",
    blurb: "You attack or defend as the point asks.",
  },
  {
    value: "defender",
    label: "Defender",
    blurb: "You chop and block, and win on placement and patience.",
  },
];

function Choice({
  selected,
  onClick,
  children,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  hint?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
        selected
          ? "border-cyan-glow/60 bg-cyan-glow/10 text-white"
          : "border-edge bg-surface-2/40 text-zinc-300 hover:border-cyan-glow/40"
      }`}
    >
      {children}
      {hint && (
        <span className="mt-1 block text-[10px] font-normal leading-tight text-cyan-glow/80">
          {hint}
        </span>
      )}
    </button>
  );
}

export function OnboardingFlow({
  needsName,
  isCoach,
  next,
}: {
  needsName: boolean;
  isCoach: boolean;
  next: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"name" | "play" | "gear">(
    needsName ? "name" : "play"
  );
  const [name, setName] = useState("");
  const [handedness, setHandedness] = useState<Handedness | null>(null);
  const [grip, setGrip] = useState<Grip | null>(null);
  const [fh, setFh] = useState<Rubber | null>(null);
  const [bh, setBh] = useState<Rubber | null>(null);
  const [style, setStyle] = useState<Style | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoFinished = useRef(false);

  const finish = async (fields: {
    handedness?: Handedness | null;
    grip?: Grip | null;
    fh?: Rubber | null;
    bh?: Rubber | null;
    style?: Style | null;
  }) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    const { error: upsertError } = await supabase
      .from("player_profiles")
      .upsert(
        {
          user_id: user.id,
          handedness: fields.handedness ?? null,
          grip: fields.grip ?? null,
          fh_rubber: fields.fh ?? null,
          bh_rubber: fields.bh ?? null,
          style: fields.style ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (upsertError) {
      setSaving(false);
      setError("We couldn't save that. Try again.");
      return;
    }
    router.replace(next);
    router.refresh();
  };

  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = displayNameError(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      data: { full_name: normalizeDisplayName(name) },
    });
    setSaving(false);
    if (updateError) {
      setError("We couldn't save your name. Try again.");
      return;
    }
    if (isCoach) {
      // Coaches are here to review someone else's matches: no player
      // questions, just the (all-null) row so this never asks again.
      void finish({});
      return;
    }
    setStep("play");
  };

  // A coach who arrived with a name (Google) has nothing to answer:
  // write the all-null row and move on without showing player questions.
  useEffect(() => {
    if (isCoach && !needsName && !autoFinished.current) {
      autoFinished.current = true;
      void finish({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoach, needsName]);

  if (isCoach && !needsName) {
    return (
      <p className="py-6 text-center text-sm text-zinc-400">Setting up…</p>
    );
  }

  // A pips or anti wing usually means a defensive game — suggest, never force.
  const suggestsDefender =
    fh === "long_pips" || fh === "anti" || bh === "long_pips" || bh === "anti";

  const skip = (
    <button
      type="button"
      onClick={() =>
        void finish({ handedness, grip, fh, bh, style })
      }
      disabled={saving}
      className="mx-auto mt-4 block text-xs text-zinc-500 transition-colors hover:text-zinc-300"
    >
      Skip for now
    </button>
  );

  if (step === "name") {
    return (
      <>
        <h1 className="text-center text-xl font-semibold">
          What should we call you?
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-400">
          We&apos;ll use this across PongLens.
        </p>
        <form onSubmit={submitName} className="mt-7">
          <input
            type="text"
            autoComplete="name"
            autoFocus
            required
            maxLength={120}
            disabled={saving}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alex"
            aria-label="Your name"
            className="w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60 focus:ring-2 focus:ring-cyan-glow/15 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {error && (
            <p role="alert" className="mt-3 text-center text-xs text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="glow-cta mt-4 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </form>
      </>
    );
  }

  if (step === "play") {
    return (
      <>
        <h1 className="text-center text-xl font-semibold">How do you play?</h1>
        <p className="mt-6 text-sm font-medium text-zinc-200">Handedness</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Choice
            selected={handedness === "right"}
            onClick={() => setHandedness("right")}
          >
            Right-handed
          </Choice>
          <Choice
            selected={handedness === "left"}
            onClick={() => setHandedness("left")}
          >
            Left-handed
          </Choice>
        </div>
        <p className="mt-5 text-sm font-medium text-zinc-200">Grip</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Choice
            selected={grip === "shakehand"}
            onClick={() => setGrip("shakehand")}
          >
            Shakehand
          </Choice>
          <Choice
            selected={grip === "penhold"}
            onClick={() => setGrip("penhold")}
          >
            Penhold
          </Choice>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-center text-xs text-red-400">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => setStep("gear")}
          disabled={saving || !handedness || !grip}
          className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
        {skip}
      </>
    );
  }

  return (
    <>
      <h1 className="text-center text-xl font-semibold">Your game</h1>
      <p className="mt-6 text-sm font-medium text-zinc-200">Forehand rubber</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {RUBBERS.map((r) => (
          <Choice
            key={r.value}
            selected={fh === r.value}
            onClick={() => setFh(r.value)}
          >
            {r.label}
          </Choice>
        ))}
      </div>
      <p className="mt-5 text-sm font-medium text-zinc-200">Backhand rubber</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {RUBBERS.map((r) => (
          <Choice
            key={r.value}
            selected={bh === r.value}
            onClick={() => setBh(r.value)}
          >
            {r.label}
          </Choice>
        ))}
      </div>
      <p className="mt-5 text-sm font-medium text-zinc-200">Playing style</p>
      <div className="mt-2 space-y-2">
        {STYLES.map((s) => (
          <div key={s.value} className="grid">
            <Choice
              selected={style === s.value}
              onClick={() => setStyle(s.value)}
              hint={
                s.value === "defender" && suggestsDefender && style === null
                  ? "Common with pips or anti"
                  : null
              }
            >
              <span className="block text-left">{s.label}</span>
              <span className="mt-0.5 block text-left text-xs font-normal text-zinc-400">
                {s.blurb}
              </span>
            </Choice>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-center text-xs text-red-400">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void finish({ handedness, grip, fh, bh, style })}
        disabled={saving}
        className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Saving…" : "Done"}
      </button>
      {skip}
    </>
  );
}
