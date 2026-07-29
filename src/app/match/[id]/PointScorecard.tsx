"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";
import type { MapLabels } from "./PlacementMap";
import {
  DIRECTIONS,
  HOW_GROUPS,
  SERVE_LENGTHS,
  SERVE_SPINS,
  SKIP_REASONS,
  canonicalHow,
  canonicalSkipReason,
  directionApplies,
  directionLabel,
  howLabel,
  lossReasonsApply,
  lossReasonsFor,
  lossReasonsSummary,
  pruneLossReasons,
  serveApplies,
  serveSummaryLabel,
} from "./scorecard";
import type { ServeInfo } from "./serving";

/**
 * EVERYTHING a viewer records about one point: who served, who won, and the
 * optional analysis behind it.
 *
 * Lifted out of PointDetail so the same questions can be asked from more than
 * one place. The point sheet mounts it as a card; the Keep-score pad and the
 * watch player will mount the same component behind their own chrome. There
 * is exactly one implementation of these questions, one set of writes, and
 * one place to add a field.
 *
 * Mount with key={point.id} (the point sheet already remounts per point): the
 * chips mirror the point's saved values for instant feedback and re-read them
 * on mount, so a new point must be a new instance.
 */

// The outcome-detail flow is a small in-place wizard that replaces the old
// two-stacked-questions layout: pick HOW it ended, then (only when placement
// is a meaningful signal) WHERE the ball went, then collapse to an editable
// SUMMARY. One question occupies the spot at a time; steps cross-fade.
//
// "serve" and "why" are OPTIONAL steps and are never entered automatically —
// they hang off the summary as Add rows. Somebody confirming 150 points
// should feel no extra friction; somebody diagnosing one point is one tap
// away from the detail.
// "idle" is the resting state and the default: just the two scoring
// questions plus an offer to go deeper. Scoring a point should never cost
// more than two taps, and somebody working through 150 of them shouldn't
// have to dismiss a question they didn't ask for. Every one of the four
// analysis questions is opt-in, entered from the idle card and returned to
// it, so the flow can't strand you.
export type FlowStep = "idle" | "how" | "placement" | "serve" | "why" | "summary";

/**
 * The "Saved" / "Couldn't save" line under the questions.
 *
 * Lives in a hook because it is shared: the game-boundary pill in the point
 * sheet's action bar flashes the same line from outside this component.
 */
export function useSaveFlash() {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const markSaved = useCallback(() => {
    setSaved(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 1500);
  }, []);
  return { saved, error, markSaved, markError: setError };
}

export type SaveFlash = ReturnType<typeof useSaveFlash>;

/** One tappable line on the flow's summary card. */
export function SummaryRow({
  label,
  value,
  emptyText = "Not recorded",
  onClick,
}: {
  label: string;
  value: string | null;
  emptyText?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-edge bg-ink/40 px-3.5 py-2.5 text-left transition-colors hover:border-cyan-glow/40"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </span>
        <span
          className={`mt-0.5 block truncate text-sm font-medium ${
            value ? "text-zinc-100" : "text-zinc-500"
          }`}
        >
          {value ?? emptyText}
        </span>
      </span>
      <span className="shrink-0 text-xs font-medium text-cyan-glow">
        {value ? "Edit" : "Add"}
      </span>
    </button>
  );
}

/** A chip in the flow's question steps. */
function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
          : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The heading line of a flow step: question on the left, a Back/Done link on
 * the right where the step has one.
 *
 * "optional" is stated ON THE QUESTION, not on the summary of the answer —
 * it's only reassuring at the moment someone is deciding whether to answer.
 */
function StepHeader({
  prompt,
  optional = false,
  actionLabel,
  onAction,
}: {
  prompt: string;
  optional?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 text-sm font-semibold text-zinc-200">
        {prompt}
        {optional && (
          <span className="ml-1.5 text-xs font-normal text-zinc-500">
            optional
          </span>
        )}
      </span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function PointScorecard({
  point,
  serve,
  neutral = false,
  mapLabels,
  flash,
  variant = "full",
  onPointUpdate,
}: {
  point: Point;
  serve: ServeInfo | undefined;
  /** Neutral / third-party match: name the two players instead of using
   *  "Me"/"Them"/"I won". */
  neutral?: boolean;
  mapLabels: MapLabels;
  /** Shared with the host, which flashes the same line from its own writes. */
  flash: SaveFlash;
  /**
   * "full" — the point sheet: who served, who won, then the analysis behind
   * it. "analysis" — the Keep-score panel, where who served and who won are
   * the pad's own controls: it opens straight into the questions and rests
   * on their summary instead of an idle card that would ask them twice.
   */
  variant?: "full" | "analysis";
  onPointUpdate: (patch: Partial<Point>) => void;
}) {
  const { markSaved, markError } = flash;

  // Scorecard state. One outcome per point: you won / they won / skipped
  // (is_let). Chips reflect only what's confirmed — with taps saving
  // immediately, a prefilled-but-unsaved selection would lie.
  const [outcome, setOutcome] = useState<"user" | "opponent" | "skip" | null>(
    point.is_let ? "skip" : point.confirmed_winner
  );
  // confirmed_how partitions by outcome: winner-hows vs skip reasons.
  const [how, setHow] = useState<string>(
    point.is_let
      ? canonicalSkipReason(point.confirmed_how)
      : point.confirmed_how
        ? canonicalHow(point.confirmed_how)
        : ""
  );
  const reduceMotion = useReducedMotion();

  // Placement of the deciding ball (fh/bh/mid), its own column. Independent
  // of the outcome; captured as the second step of the flow below.
  const [direction, setDirection] = useState<string>(point.direction ?? "");

  // Optional serve diagnosis (receive error / ace only). Spin is a base axis
  // plus a sidespin toggle, so side-under and side-top are two taps rather
  // than their own chips.
  const [serveSpin, setServeSpin] = useState<string>(point.serve_spin ?? "");
  const [serveSide, setServeSide] = useState<boolean>(!!point.serve_sidespin);
  const [serveLength, setServeLength] = useState<string>(
    point.serve_length ?? ""
  );

  // Optional multi-select reasons the owner lost this point.
  const [lossReasons, setLossReasons] = useState<string[]>(
    point.loss_reasons ?? []
  );

  // Always open on the scoring questions, whether or not analysis exists.
  // Opening straight into the flow on a revisit would put the deep questions
  // in front of the shallow one you actually came back for. The analysis
  // variant has no scoring questions to open on, so it starts at the first
  // unanswered one — or the summary, on a point that already has answers.
  const [flowStep, setFlowStep] = useState<FlowStep>(
    variant === "analysis" ? (point.confirmed_how ? "summary" : "how") : "idle"
  );
  // In the analysis variant "idle" has nothing to show, so Done from the
  // summary rests there instead of emptying the panel.
  const step: FlowStep =
    variant === "analysis" && flowStep === "idle" ? "summary" : flowStep;

  // Every explicit interaction saves immediately — there is no
  // Confirm/Update button. One atomic write per change
  // (winner and is_let are mutually exclusive — DB constraint
  // points_let_never_scored — so both sides of the pair travel together).
  const writeScorecard = useCallback(
    async (patch: {
      confirmed_winner: "user" | "opponent" | null;
      confirmed_how: string | null;
      is_let: boolean;
    }) => {
      markError(null);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update(patch)
        .eq("id", point.id);
      if (error) {
        markError("Couldn't save. Tap again.");
        return;
      }
      onPointUpdate(patch);
      markSaved();
    },
    [point.id, onPointUpdate, markSaved, markError]
  );

  // One write for the optional detail columns. Callers set their own state
  // optimistically and roll it back when this resolves false, same contract
  // as saveDirection.
  const writeDetail = useCallback(
    async (patch: Partial<Point>) => {
      markError(null);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update(patch)
        .eq("id", point.id);
      if (error) {
        markError("Couldn't save. Tap again.");
        return false;
      }
      onPointUpdate(patch);
      markSaved();
      return true;
    },
    [point.id, onPointUpdate, markSaved, markError]
  );

  // Drop detail that a changed how / outcome has made meaningless, so the
  // summary never shows a serve for a point that no longer turned on one.
  const clearServe = useCallback(() => {
    setServeSpin("");
    setServeSide(false);
    setServeLength("");
    void writeDetail({
      serve_spin: null,
      serve_sidespin: null,
      serve_length: null,
    });
  }, [writeDetail]);

  const clearLossReasons = useCallback(() => {
    setLossReasons([]);
    void writeDetail({ loss_reasons: null });
  }, [writeDetail]);

  // Whether the OWNER served this point — the rotation is the authority, the
  // same source the point's server chip uses. Gates the serve-only reasons.
  const iServed = serve?.server === "user";

  /**
   * The next question worth asking after `from`, skipping the ones this
   * ending doesn't support and landing on the summary when none are left.
   *
   * The flow runs straight through rather than returning to the summary
   * after each answer: once you've opted into analysing a point, being sent
   * back to a menu between every question is the slow way to do it. Any step
   * can be skipped, so running through costs nothing.
   *
   * `forHow` is passed rather than read from state because the caller is
   * usually the tap that just CHOSE it, and state hasn't updated yet.
   */
  const advanceFrom = useCallback(
    (from: FlowStep, forHow: string): FlowStep => {
      const order: FlowStep[] = ["how", "placement", "serve", "why"];
      const applies = (s: FlowStep) =>
        s === "placement"
          ? directionApplies(forHow)
          : s === "serve"
            ? serveApplies(forHow)
            : s === "why"
              ? !neutral &&
                outcome === "opponent" &&
                lossReasonsApply(forHow, iServed)
              : true;
      for (let i = order.indexOf(from) + 1; i < order.length; i++) {
        if (applies(order[i])) return order[i];
      }
      return "summary";
    },
    [neutral, outcome, iServed]
  );

  /**
   * Where answering a question takes you.
   *
   * Running the flow forward, an answer moves to the next question — no
   * button. Arriving at a question FROM the summary (you tapped Edit on one
   * row), an answer goes back to the summary, because that is the one thing
   * you came to change. Same tap, two meanings, decided by how you got here.
   */
  const fromSummaryRef = useRef(false);
  const openStepFromSummary = (s: FlowStep) => {
    fromSummaryRef.current = true;
    setFlowStep(s);
  };
  const goAfter = (from: FlowStep, forHow = how) => {
    if (fromSummaryRef.current) {
      fromSummaryRef.current = false;
      setFlowStep("summary");
      return;
    }
    setFlowStep(advanceFrom(from, forHow));
  };

  // "Why did you lose it" is multi-select, so it cannot advance on the first
  // tap — you may want three reasons. It advances when you stop tapping.
  const whyTimer = useRef<number | null>(null);
  const settleWhy = () => {
    if (whyTimer.current) window.clearTimeout(whyTimer.current);
    whyTimer.current = window.setTimeout(() => {
      whyTimer.current = null;
      goAfter("why");
    }, 1400);
  };
  useEffect(
    () => () => {
      if (whyTimer.current) window.clearTimeout(whyTimer.current);
    },
    []
  );

  /**
   * What the step's forward link should say. "Done" when nothing follows,
   * otherwise "Skip" for the steps a single tap answers and "Next" for the
   * serve, where you tap several chips and then move on deliberately.
   */
  const stepAction = (from: FlowStep) => {
    const last = advanceFrom(from, how) === "summary";
    // In the panel the host's Done is the way out, so a step's link never
    // says Done as well — two Done buttons on one screen make you pick.
    if (last && variant === "full") return "Done";
    return from === "serve" || (last && from === "why") ? "Next" : "Skip";
  };

  // A changed ending offers a different reason set, so anything the new one
  // doesn't offer has to go rather than linger invisibly in the data.
  const prunePointLossReasons = useCallback(
    (nextHow: string) => {
      const kept = pruneLossReasons(lossReasons, nextHow, iServed);
      if (kept.length === lossReasons.length) return;
      setLossReasons(kept);
      void writeDetail({ loss_reasons: kept.length ? kept : null });
    },
    [lossReasons, iServed, writeDetail]
  );

  const pickOutcome = useCallback(
    (next: "user" | "opponent" | "skip") => {
      const confirmedOutcome: "user" | "opponent" | "skip" | null =
        point.is_let ? "skip" : point.confirmed_winner;
      if (next === confirmedOutcome) {
        // Tapping the confirmed outcome clears it (same as timeline rows).
        setOutcome(null);
        setHow("");
        setFlowStep("idle");
        if (serveSpin || serveSide || serveLength) clearServe();
        if (lossReasons.length) clearLossReasons();
        void writeScorecard({
          confirmed_winner: null,
          confirmed_how: null,
          is_let: false,
        });
        return;
      }
      // Switching between the winner and skip partitions drops a how that
      // isn't valid on the other side.
      const nextHow =
        next === "skip" ? canonicalSkipReason(how) : canonicalHow(how);
      setOutcome(next);
      setHow(nextHow);
      // "Why did you lose it" is first-person: the moment this point stops
      // being one you lost, any reasons on it are meaningless.
      if (next !== "opponent" && lossReasons.length) clearLossReasons();
      if (next === "skip" && (serveSpin || serveSide || serveLength)) {
        clearServe();
      }
      // Scoring never opens the flow. Analysis is entered deliberately from
      // the idle card, so picking a winner just scores the point.
      setFlowStep("idle");
      void writeScorecard(
        next === "skip"
          ? { confirmed_winner: null, confirmed_how: nextHow || null, is_let: true }
          : { confirmed_winner: next, confirmed_how: nextHow || null, is_let: false }
      );
    },
    [
      point.is_let,
      point.confirmed_winner,
      how,
      serveSpin,
      serveSide,
      serveLength,
      lossReasons,
      writeScorecard,
      clearServe,
      clearLossReasons,
    ]
  );

  // Low-level write of the placement column, shared by the placement chips
  // and the "drop stale placement" path when a non-placement how is chosen.
  const saveDirection = useCallback(
    async (next: string) => {
      const prev = direction;
      setDirection(next);
      markError(null);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ direction: next || null })
        .eq("id", point.id);
      if (error) {
        markError("Couldn't save. Tap again.");
        setDirection(prev);
        return false;
      }
      onPointUpdate({ direction: (next || null) as Point["direction"] });
      markSaved();
      return true;
    },
    [direction, point.id, onPointUpdate, markSaved, markError]
  );

  const pickHow = (v: string) => {
    {
      setHow(v);
      if (outcome) {
        void writeScorecard(
          outcome === "skip"
            ? { confirmed_winner: null, confirmed_how: v || null, is_let: true }
            : {
                confirmed_winner: outcome,
                confirmed_how: v || null,
                is_let: false,
              }
        );
      }
      // Skip keeps its flat toggle UI; only the winner flow advances.
      if (!outcome || outcome === "skip") return;
      // The optional detail is scoped to particular hows, so a change here
      // can strand it. Drop what no longer applies before moving on.
      if (!serveApplies(v) && (serveSpin || serveSide || serveLength)) {
        clearServe();
      }
      prunePointLossReasons(v);
      // Luck / "other": placement doesn't inform anything, so drop any stale
      // direction rather than carrying one that no longer applies.
      if (!directionApplies(v) && direction) void saveDirection("");
      goAfter("how", v);
    }
  };

  // Placement step: a tap picks fh/bh/mid (or "na" to dismiss) and carries
  // on. No toggle — the flow always moves forward from here.
  const pickPlacement = async (v: "fh" | "bh" | "mid" | "na") => {
    const ok = await saveDirection(v === "na" ? "" : v);
    if (ok) goAfter("placement");
  };

  // The serve step stays open across taps (two rows to fill), so every chip
  // is a toggle and "Done" is what returns to the summary.
  // "No spin" and sidespin are mutually exclusive — a ball is either spinless
  // or it has sidespin on it, and "No spin + Sidespin" reads as nonsense even
  // though it was meant as "pure sidespin". Pure sidespin is the sidespin chip
  // on its own, so the contradictory pair is simply unreachable.
  const pickServeSpin = async (v: string) => {
    const prevSpin = serveSpin;
    const prevSide = serveSide;
    const nextSpin = prevSpin === v ? "" : v;
    const nextSide = nextSpin === "none" ? false : prevSide;
    setServeSpin(nextSpin);
    setServeSide(nextSide);
    const ok = await writeDetail({
      serve_spin: (nextSpin || null) as Point["serve_spin"],
      serve_sidespin: nextSide || null,
    });
    if (!ok) {
      setServeSpin(prevSpin);
      setServeSide(prevSide);
      return;
    }
    // Both halves of the question answered = the question is answered.
    if (nextSpin && serveLength) goAfter("serve");
  };

  const toggleServeSide = useCallback(async () => {
    const prevSpin = serveSpin;
    const prevSide = serveSide;
    const nextSide = !prevSide;
    const nextSpin = nextSide && prevSpin === "none" ? "" : prevSpin;
    setServeSide(nextSide);
    setServeSpin(nextSpin);
    const ok = await writeDetail({
      serve_sidespin: nextSide || null,
      serve_spin: (nextSpin || null) as Point["serve_spin"],
    });
    if (!ok) {
      setServeSide(prevSide);
      setServeSpin(prevSpin);
    }
  }, [serveSpin, serveSide, writeDetail]);

  const pickServeLength = async (v: string) => {
    const prev = serveLength;
    const next = prev === v ? "" : v;
    setServeLength(next);
    const ok = await writeDetail({
      serve_length: (next || null) as Point["serve_length"],
    });
    if (!ok) {
      setServeLength(prev);
      return;
    }
    if (next && serveSpin) goAfter("serve");
  };

  const toggleLossReason = async (v: string) => {
    const prev = lossReasons;
    const next = prev.includes(v) ? prev.filter((r) => r !== v) : [...prev, v];
    setLossReasons(next);
    // null rather than [] when empty, so "unanswered" and "answered with
    // nothing" don't become two different shapes in the data.
    const ok = await writeDetail({ loss_reasons: next.length ? next : null });
    if (!ok) {
      setLossReasons(prev);
      return;
    }
    if (next.length) settleWhy();
  };

  const youLabel = neutral ? mapLabels.you : "Me";
  const themLabel = neutral ? mapLabels.them : "Them";

  // Group labels follow the selected winner so "They missed" reads right.
  // Neutral names the actor; normal keeps the "I"/"They" pronouns.
  const groupLabel = (g: (typeof HOW_GROUPS)[number]) => {
    if (g.id === "miss") {
      if (neutral)
        return outcome === "opponent"
          ? `${mapLabels.you} missed`
          : `${mapLabels.them} missed`;
      return outcome === "opponent" ? "I missed" : "They missed";
    }
    if (g.id === "won") {
      if (outcome !== "opponent" && outcome !== "user") return "Won it";
      if (neutral)
        return outcome === "opponent"
          ? `${mapLabels.them} won it`
          : `${mapLabels.you} won it`;
      return outcome === "opponent" ? "They won it" : "I won it";
    }
    return g.label;
  };

  // Placement follow-up: only meaningful for hows where the ball was aimed.
  const placementRelevant = directionApplies(how);
  // The question adapts to who won — "they" placed it on your side, or "you"
  // placed it on theirs — so the answer reads as tactical intent either way.
  const placementActor =
    outcome === "opponent"
      ? neutral
        ? mapLabels.them
        : "they"
      : neutral
        ? mapLabels.you
        : "you";
  const placementPrompt = `Where did ${placementActor} place the ball to win the point?`;
  const placementValueLabel = directionLabel(direction);

  // Serve follow-up: on a receive error or an ace, the WINNER served, so the
  // question is about your serve when you won and theirs when you didn't.
  const serveRelevant = serveApplies(how);
  // On a receive error or an ace the winner served, so the question can name
  // sides. A clean winner could be your third ball off your own serve OR your
  // attack on theirs, and we don't try to tell those apart — so it asks the
  // neutral question about the serve that started the point.
  const servePrompt =
    how === "clean_winner"
      ? "Which serve set it up?"
      : !neutral && outcome === "opponent"
        ? "Which serve beat you?"
        : "Which serve won it?";
  const serveValueLabel = serveSummaryLabel(serveSpin, serveSide, serveLength);

  // Loss follow-up: strictly first-person, so only on points the owner lost
  // and never on a neutral third-party match, where "you" has no referent.
  const lossRelevant =
    !neutral && outcome === "opponent" && lossReasonsApply(how, iServed);
  // The chips on offer narrow to what the ending could plausibly explain.
  const lossOptions = lossReasonsFor(how, iServed);
  const lossValueLabel = lossReasonsSummary(lossReasons);

  // One line standing in for everything recorded, shown on the idle card so
  // you can see what a point holds without opening it.
  const analysisValue =
    [
      howLabel(how),
      placementRelevant ? placementValueLabel : null,
      serveRelevant ? serveValueLabel : null,
      lossRelevant ? lossValueLabel : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;

  // Cross-fade the wizard step in place; a plain fade when motion is reduced.
  const stepMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.12 },
      }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6 },
        transition: { duration: 0.18, ease: "easeOut" as const },
      };

  return (
    <section
      data-peek="card"
      className="rounded-xl border border-edge bg-surface-2/40 p-4"
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === "idle" && (
          <motion.div key="idle" {...stepMotion}>
            <h3 className="text-sm font-semibold text-zinc-200">
              Who won this point?
            </h3>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {(
                [
                  { value: "user", label: youLabel },
                  { value: "opponent", label: themLabel },
                  { value: "skip", label: "Skip" },
                ] as const
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={outcome === o.value}
                  onClick={() => pickOutcome(o.value)}
                  className={`min-w-0 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${
                    outcome === o.value
                      ? o.value === "skip"
                        ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                        : "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                  }`}
                >
                  <span className="block truncate">{o.label}</span>
                </button>
              ))}
            </div>

            {/* Skip keeps a flat one-tap reason list — no placement, no flow.
                A skipped ball never scored, so "where did it go" is moot. */}
            {outcome === "skip" && (
              <div className="mt-5">
                <span className="text-sm font-semibold text-zinc-200">
                  Why skip it?
                </span>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {SKIP_REASONS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => pickHow(how === r.value ? "" : r.value)}
                      aria-pressed={how === r.value}
                      className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
                        how === r.value
                          ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                          : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* The offer to go deeper, and the record of what's already there.
                Scored points only: a skipped ball has nothing to analyse. */}
            {(outcome === "user" || outcome === "opponent") && (
              <div className="mt-5">
                <SummaryRow
                  label="Analysis"
                  value={analysisValue}
                  emptyText="How it ended, placement, serve"
                  onClick={() => setFlowStep(analysisValue ? "summary" : "how")}
                />
              </div>
            )}
          </motion.div>
        )}

        {/* The analysis questions REPLACE the scoring ones rather than
            stacking under them: one question owns the card at a time, and
            the summary is where you land when they're answered. */}
        {(outcome === "user" || outcome === "opponent") && (
          <>
            {step === "how" && (
              <motion.div key="how" {...stepMotion}>
                <StepHeader
                  prompt="How did it end?"
                  optional
                  actionLabel={stepAction("how")}
                  onAction={() => goAfter("how")}
                />
                <div className="mt-2.5 space-y-3">
                  {HOW_GROUPS.map((g) => (
                    <div key={g.id}>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        {groupLabel(g)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {g.options.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => pickHow(o.value)}
                            aria-pressed={how === o.value}
                            className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
                              how === o.value
                                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                                : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {step === "placement" && (
              <motion.div key="placement" {...stepMotion}>
                <StepHeader
                  prompt={placementPrompt}
                  optional
                  actionLabel={stepAction("placement")}
                  onAction={() => goAfter("placement")}
                />
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {DIRECTIONS.map((d) => (
                    <Chip
                      key={d.value}
                      label={d.label}
                      active={direction === d.value}
                      onClick={() => void pickPlacement(d.value)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => void pickPlacement("na")}
                    className="rounded-full border border-dashed border-edge bg-transparent px-3.5 py-2 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    Not applicable
                  </button>
                </div>
              </motion.div>
            )}

            {/* Serve diagnosis. Two rows, so unlike the placement step
                this one stays open across taps and "Done" is what
                returns to the summary. Spin is a base plus a sidespin
                modifier: side-under and side-top are two taps, which is
                how players describe them anyway. */}
            {step === "serve" && (
              <motion.div key="serve" {...stepMotion}>
                <StepHeader
                  prompt={servePrompt}
                  optional
                  actionLabel={stepAction("serve")}
                  onAction={() => goAfter("serve")}
                />
                <p className="mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Spin
                </p>
                <div className="flex flex-wrap gap-2">
                  {SERVE_SPINS.map((s) => (
                    <Chip
                      key={s.value}
                      label={s.label}
                      active={serveSpin === s.value}
                      onClick={() => void pickServeSpin(s.value)}
                    />
                  ))}
                  <Chip
                    label="+ Sidespin"
                    active={serveSide}
                    onClick={() => void toggleServeSide()}
                  />
                </div>
                <p className="mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Length
                </p>
                <div className="flex flex-wrap gap-2">
                  {SERVE_LENGTHS.map((l) => (
                    <Chip
                      key={l.value}
                      label={l.label}
                      active={serveLength === l.value}
                      onClick={() => void pickServeLength(l.value)}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {/* Why you lost it. Multi-select, so it also stays open. */}
            {step === "why" && (
              <motion.div key="why" {...stepMotion}>
                <StepHeader
                  prompt="Why did you lose it?"
                  optional
                  actionLabel={stepAction("why")}
                  onAction={() => goAfter("why")}
                />
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {lossOptions.map((r) => (
                    <Chip
                      key={r.value}
                      label={r.label}
                      active={lossReasons.includes(r.value)}
                      onClick={() => void toggleLossReason(r.value)}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {step === "summary" && (
              <motion.div key="summary" {...stepMotion} className="space-y-2">
                <SummaryRow
                  label="How it ended"
                  value={howLabel(how)}
                  emptyText="Not sure yet"
                  onClick={() => openStepFromSummary("how")}
                />

                {placementRelevant && (
                  <SummaryRow
                    label="Placement"
                    value={placementValueLabel}
                    onClick={() => openStepFromSummary("placement")}
                  />
                )}

                {serveRelevant && (
                  <SummaryRow
                    label="Serve"
                    value={serveValueLabel}
                    onClick={() => openStepFromSummary("serve")}
                  />
                )}

                {lossRelevant && (
                  <SummaryRow
                    label="Why I lost"
                    value={lossValueLabel}
                    onClick={() => openStepFromSummary("why")}
                  />
                )}

                {/* Only the full card has somewhere to go: in the panel the
                    summary IS the resting state, and its host's Done is the
                    way out — two Dones, one of them a no-op, is worse than
                    none. */}
                {variant === "full" && (
                  <button
                    type="button"
                    onClick={() => setFlowStep("idle")}
                    className="w-full pt-1 text-center text-xs font-semibold text-cyan-glow transition-colors hover:text-white"
                  >
                    Done
                  </button>
                )}
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>

      <div className="mt-3 flex h-4 items-center gap-3 text-xs">
        {flash.saved && <span className="text-emerald-400">Saved</span>}
        {flash.error && <span className="text-red-400">{flash.error}</span>}
      </div>
    </section>
  );
}
