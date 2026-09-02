"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { displayNameError, normalizeDisplayName } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/client";
import { setWorkspace } from "@/lib/workspace";

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
  | "club"
  | "regional"
  | "national"
  | "international";

/**
 * A ladder, not adjectives — and the top of it is facts.
 *
 * Every international system that works climbs the same rungs at the top:
 * club, regional, national, international. Padel's 1-to-7 scale (used
 * across Spain, Sweden and Belgium) and the USATT bands quoted throughout
 * table tennis both land there, because those four words are what the
 * sport calls itself everywhere and they survive translation. "Advanced"
 * does not travel the same way: it is a judgement, and a judgement has to
 * be re-argued in every language.
 *
 * The top four are facts for a second reason. Self-declared level runs
 * optimistic by half a rung to a full one — padel's own guidance says so
 * outright. Ask someone to rate themselves and you get flattery; ask
 * whether they play a league and you get an answer that is true.
 *
 * So: skill words at the bottom, where a player has no competition to
 * point at, and facts above. Seven rungs, and the prompt tells you to pick
 * the highest one that applies.
 */
const LEVELS: { value: Level; label: string; blurb: string }[] = [
  { value: "beginner", label: "Beginner", blurb: "Learning the basic strokes." },
  {
    value: "intermediate",
    label: "Intermediate",
    blurb: "You rally with spin and control.",
  },
  {
    value: "advanced",
    label: "Advanced",
    blurb: "Strong technique, and you train regularly.",
  },
  {
    value: "club",
    label: "Club",
    blurb: "You play club matches or a local league.",
  },
  {
    value: "regional",
    label: "Regional",
    blurb: "You compete at regional or state level.",
  },
  {
    value: "national",
    label: "National",
    blurb: "You compete at national level.",
  },
  {
    value: "international",
    label: "International",
    blurb: "You represent your country, or play professionally.",
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
  isNew,
  next,
}: {
  needsName: boolean;
  isCoach: boolean;
  /** No player_profiles row yet. The role question keys on this, not on
   *  the name — Google and Apple sign-ups arrive with a name. */
  isNew: boolean;
  next: string;
}) {
  const router = useRouter();
  // The Upwork question (158), asked once of brand-new accounts: which
  // side of the table are you on. Invite-born coaches never see it — the
  // invite already answered. "player" runs the existing flow; "coach"
  // answers the name and lands in the coaching workspace.
  // `role` is the highlighted card; it only counts once Continue is tapped
  // (roleChosen). "both" walks the playing questions and flags the coach.
  const [role, setRole] = useState<"player" | "coach" | "both" | null>(null);
  const [roleChosen, setRoleChosen] = useState(!(isNew && !isCoach));
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

  /** Writes the profile row. `setupDone` stamps the playing questions as
   *  answered or explicitly skipped (159); the coach paths leave it empty
   *  so the dashboard can offer them the day they switch sides. */
  const finish = async (
    fields: {
      handedness?: Handedness | null;
      grip?: Grip | null;
      level?: Level | null;
    },
    destination: string = next,
    setupDone: boolean = true,
  ) => {
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
          setup_done_at: setupDone ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (upsertError) {
      setSaving(false);
      setError("We couldn't save that. Try again.");
      return;
    }
    if (role === "both") {
      // Both sides: the playing side first, coaching one switch away, and
      // the flag so the switch offers itself.
      await supabase.auth.updateUser({ data: { is_coach: true } });
    }
    router.replace(destination);
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
      // questions, just the (unstamped) row so this never asks again.
      void finish({}, next, false);
      return;
    }
    if (role === "coach") {
      // A chosen coach: the flag and the cookie put the coaching side up
      // first, and the unstamped row keeps the gate quiet.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await supabase.auth.updateUser({ data: { is_coach: true } });
      if (user) setWorkspace(user.id, "coach");
      void finish({}, "/coaching", false);
      return;
    }
    setStep("play");
  };

  // A coach who arrived with a name (Google) has nothing to answer:
  // write the all-null row and move on without showing player questions.
  useEffect(() => {
    if (isCoach && !needsName && !autoFinished.current) {
      autoFinished.current = true;
      void finish({}, next, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoach, needsName]);

  if (isCoach && !needsName) {
    return (
      <p className="py-6 text-center text-sm text-zinc-400">Setting up…</p>
    );
  }

  if (!roleChosen) {
    const continueFromRole = async () => {
      if (!role) return;
      setRoleChosen(true);
      // With a name already on the account (Google, Apple) there is
      // nothing left to ask a coach: mark, remember the side, write the row.
      if (role === "coach" && !needsName) {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        await supabase.auth.updateUser({ data: { is_coach: true } });
        if (user) setWorkspace(user.id, "coach");
        void finish({}, "/coaching", false);
      }
    };
    return (
      <>
        <h1 className="text-center text-xl font-semibold sm:text-2xl">
          How will you use PongLens?
        </h1>
        <div className="mt-7 space-y-3">
          <RoleCard
            selected={role === "player"}
            onClick={() => setRole("player")}
            title="I play"
            blurb="Film your matches, score them, and see where your game is going."
            icon="paddle"
          />
          <RoleCard
            selected={role === "coach"}
            onClick={() => setRole("coach")}
            title="I coach"
            blurb="Keep lesson notes on each student and follow the matches they share."
            icon="notes"
          />
          <RoleCard
            selected={role === "both"}
            onClick={() => setRole("both")}
            title="Both"
            blurb="Your own game and your students, one account, a switch between them."
            icon="people"
          />
        </div>
        {error && (
          <p role="alert" className="mt-3 text-center text-xs text-red-400">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => void continueFromRole()}
          disabled={!role || saving}
          className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </>
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
      {/* The rungs overlap by design — an advanced player who turns out
          for a league is both. One line settles it. */}
      <p className="mt-0.5 text-xs text-zinc-500">
        Pick the highest one that&apos;s true.
      </p>
      {/* grid, not space-y: a button is inline-block, so a plain stack
          leaves each card shrink-wrapped to its own blurb and the column
          comes out ragged. */}
      <div className="mt-2 grid gap-2">
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


/** One of the three ways in, drawn as a selectable card: an icon tile,
 *  a title, one line, and the cyan ring when it is the pick. */
function RoleCard({
  selected,
  onClick,
  title,
  blurb,
  icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
  icon: "paddle" | "notes" | "people";
}) {
  const path =
    icon === "paddle"
      ? "M14.5 3.5a6 6 0 0 1 4.2 10.3l-1.1 1.1-4.9-4.9 1.1-1.1a6 6 0 0 1 .7-5.4Zm-3.2 8 4.9 4.9-6.3 6.3a1.6 1.6 0 0 1-2.3 0l-2.6-2.6a1.6 1.6 0 0 1 0-2.3l6.3-6.3Z"
      : icon === "notes"
        ? "M6.5 3.5h11A1.5 1.5 0 0 1 19 5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5ZM9 3.5v17M12 8.5h4M12 12h4"
        : "M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 7.5c.9-2.9 3.2-4.5 6-4.5s5.1 1.6 6 4.5M15.5 5.6a3 3 0 0 1 0 5.8M17.6 15.4c1.7.6 2.9 1.9 3.4 4.1";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all ${
        selected
          ? "border-cyan-glow/70 bg-cyan-glow/[0.08] shadow-[0_0_28px_rgba(34,211,238,0.18)]"
          : "border-edge bg-surface-2/60 hover:border-zinc-500"
      }`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
          selected ? "bg-cyan-glow text-ink" : "bg-cyan-glow/10 text-cyan-glow"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={path} />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-zinc-100">{title}</span>
        <span className="mt-0.5 block text-sm leading-snug text-zinc-400">{blurb}</span>
      </span>
      <svg
        viewBox="0 0 24 24"
        className={`h-5 w-5 shrink-0 ${selected ? "text-cyan-glow" : "text-zinc-700"}`}
        fill={selected ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        {selected && (
          <path d="m8.5 12.5 2.3 2.3 4.7-5" fill="none" stroke="#0a0a0a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
