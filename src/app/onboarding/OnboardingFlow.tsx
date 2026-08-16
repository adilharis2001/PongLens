"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { displayNameError, normalizeDisplayName } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/client";

/**
 * First-login setup, cut to what actually changes something:
 *
 *   name  — only when the account has none (email sign-ins; Google
 *           arrives with one).
 *   play  — handedness, grip and level, on one screen.
 *
 * It used to be three screens and eight questions, with rubbers and
 * playing style in the middle, and it ended on a pair of buttons — Done
 * and Skip for now — that did exactly the same thing, because nothing was
 * required. Gear moves to Account, where a thing you change every season
 * belongs.
 *
 * What did NOT move is handedness. The obvious cut was to push the whole
 * profile into a checklist and let people get straight to uploading, but a
 * left-hander who never fills it in gets worse analysis forever, and a
 * checklist item is precisely the thing nobody completes. So the questions
 * that feed our output stay in the flow and the rest leaves.
 *
 * Level is new (115): five words, one tap, and the one piece of context
 * about a player that nothing in the footage can tell us.
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
type Level =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "advanced_pro"
  | "national";

/**
 * Deliberately words, not a rating. USATT points mean nothing to a player
 * in Europe or China, and a number in front of a beginner is a wall. These
 * are the phrases players everywhere already use about themselves.
 */
const LEVELS: { value: Level; label: string; blurb: string }[] = [
  { value: "beginner", label: "Beginner", blurb: "Learning the strokes." },
  {
    value: "intermediate",
    label: "Intermediate",
    blurb: "You play regularly and rally with spin.",
  },
  { value: "advanced", label: "Advanced", blurb: "You compete at club level." },
  {
    value: "advanced_pro",
    label: "Advanced pro",
    blurb: "Ranked tournaments, and you train for them.",
  },
  {
    value: "national",
    label: "National",
    blurb: "National level or above.",
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
  const [step, setStep] = useState<"name" | "play">(
    needsName ? "name" : "play"
  );
  const [name, setName] = useState("");
  const [handedness, setHandedness] = useState<Handedness | null>(null);
  const [grip, setGrip] = useState<Grip | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoFinished = useRef(false);

  const finish = async (fields: {
    handedness?: Handedness | null;
    grip?: Grip | null;
    level?: Level | null;
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
          level: fields.level ?? null,
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
        <Choice selected={grip === "penhold"} onClick={() => setGrip("penhold")}>
          Penhold
        </Choice>
      </div>

      <p className="mt-5 text-sm font-medium text-zinc-200">Your level</p>
      <div className="mt-2 space-y-2">
        {LEVELS.map((l) => (
          <Choice
            key={l.value}
            selected={level === l.value}
            onClick={() => setLevel(l.value)}
          >
            <span className="block text-left">{l.label}</span>
            <span className="mt-0.5 block text-left text-xs font-normal text-zinc-400">
              {l.blurb}
            </span>
          </Choice>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-center text-xs text-red-400">
          {error}
        </p>
      )}

      {/* One button, not two. This screen used to end on Done beside Skip
          for now, which wrote the same row either way — two controls for
          one outcome. Everything here is optional, so the button says so
          and the screen stops pretending otherwise. */}
      <button
        type="button"
        onClick={() => void finish({ handedness, grip, level })}
        disabled={saving}
        className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving
          ? "Saving…"
          : handedness || grip || level
            ? "Done"
            : "Skip for now"}
      </button>
      <p className="mt-3 text-center text-xs text-zinc-500">
        You can change any of this later in Account.
      </p>
    </>
  );
}
