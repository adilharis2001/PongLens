"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";
import type { MapLabels } from "./PlacementMap";
import {
  MISREAD_WHERE,
  SERVE_LENGTHS,
  SERVE_SPINS,
  SKIP_REASONS,
  canonicalHow,
  canonicalSkipReason,
  customReasonValue,
  directionLabel,
  howLabel,
  lossReasonsFor,
  lossReasonsSummary,
  misreadDetailApplies,
  serverContextLine,
  MAX_CUSTOM_REASON_LEN,
  pruneLossReasons,
  serveApplies,
  serveSummaryLabel,
  type CustomReasonLabels,
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
/**
 * The analysis flow, since migration 060.
 *
 * "why" leads and is the only question always asked. The old chain opened
 * on "how did it end" and reached "why" third, gated on the ending — so the
 * answer worth having was unreachable until two that were not had been
 * given. "how" and "placement" are gone as steps; confirmed_how is still
 * written, but only by the misread follow-up.
 */
export type FlowStep = "idle" | "why" | "misread" | "serve" | "summary";

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
  /** Omitted for retired answers: readable, with no step left to open. */
  onClick?: () => void;
}) {
  const body = (
    <>
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
      {onClick && (
        <span className="shrink-0 text-xs font-medium text-cyan-glow">
          {value ? "Edit" : "Add"}
        </span>
      )}
    </>
  );
  const shell =
    "flex w-full items-center justify-between gap-3 rounded-lg border border-edge bg-ink/40 px-3.5 py-2.5 text-left";
  if (!onClick) return <div className={shell}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${shell} transition-colors hover:border-cyan-glow/40`}
    >
      {body}
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
  customReasons = [],
  onCreateCustomReason,
  onFlowState,
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
  /**
   * The match owner's own reason pills (loss_reason_labels, migration 060).
   * Owner-keyed like tags, so one problem counts once across every match.
   */
  customReasons?: { id: string; label: string }[];
  /**
   * Create a pill and return its id, or null if it couldn't be saved. The
   * host owns the vocabulary list so a pill made here shows up on the next
   * point without a refetch.
   */
  onCreateCustomReason?: (label: string) => Promise<string | null>;
  /**
   * Where the flow stands: `settled` = nothing left to ask, `open` = a
   * question is showing. Deliberately NOT "is this the first report" —
   * Strict Mode double-invokes effects, so any such flag reads true then
   * false on mount and the host's countdown gets armed and immediately
   * cancelled. State alone is idempotent, and real interaction cancels via
   * the host's pointer capture, which no remount can fake.
   */
  onFlowState?: (state: "settled" | "open") => void;
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

  // Placement of the deciding ball (fh/bh/mid). RETIRED as a question in
  // 060 — read only, so points that answered it still show the answer.
  const direction = point.direction ?? "";

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
    variant === "analysis"
      ? point.loss_reasons?.length
        ? "summary"
        : "why"
      : "idle"
  );
  // In the analysis variant "idle" has nothing to show, so Done from the
  // summary rests there instead of emptying the panel.
  const step: FlowStep =
    variant === "analysis" && flowStep === "idle" ? "summary" : flowStep;

  /**
   * Tell the host where the flow stands, so the Keep-score panel can let
   * itself out without guessing on a clock. A blind timer would race the
   * flow: answering "Misread the spin" settles into the where-it-went
   * follow-up 1.4s later, so a 2s close would flash that question and
   * swallow it. Landing on the summary is the real "nothing left to ask".
   *
   * The FIRST report is different from every later one. On mount an open
   * question means the sheet has just appeared and nobody has read it yet —
   * the host's long window applies. Later, an open question means a tap
   * just re-opened one, which is someone working: cancel the exit outright.
   */
  // Held in a ref, and the effect depends on `step` ALONE. Hosts pass an
  // inline arrow, so keeping the callback in the dep array would re-fire
  // this on every parent render — reporting "a question re-opened" when
  // nothing had, which cancels the host's countdown forever.
  const flowStateRef = useRef(onFlowState);
  flowStateRef.current = onFlowState;
  useEffect(() => {
    flowStateRef.current?.(step === "summary" ? "settled" : "open");
  }, [step]);

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
  // same source the point's server chip uses. Tri-state on purpose: with
  // first_server unset the rotation cannot name a server, and `=== "user"`
  // would quietly report "they served" and offer "Receive error" on a point
  // the owner may well have served. Unknown offers neither mirror.
  const iServed: boolean | null =
    serve?.server == null ? null : serve.server === "user";

  /**
   * The next question worth asking after `from`, skipping the ones this
   * ending doesn't support and landing on the summary when none are left.
   *
   * The flow runs straight through rather than returning to the summary
   * after each answer: once you've opted into analysing a point, being sent
   * back to a menu between every question is the slow way to do it. Any step
   * can be skipped, so running through costs nothing.
   *
   * `forReasons` is passed rather than read from state because the caller is
   * usually the tap that just CHANGED them, and state hasn't updated yet.
   * Both follow-ups hang off the reasons now, so this is the only input.
   */
  const advanceFrom = useCallback(
    (from: FlowStep, forReasons: string[]): FlowStep => {
      const order: FlowStep[] = ["why", "misread", "serve"];
      const applies = (s: FlowStep) =>
        s === "misread"
          ? misreadDetailApplies(forReasons)
          : s === "serve"
            ? serveApplies(forReasons)
            : true;
      for (let i = order.indexOf(from) + 1; i < order.length; i++) {
        if (applies(order[i])) return order[i];
      }
      return "summary";
    },
    []
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
  const goAfter = (from: FlowStep, forReasons = lossReasons) => {
    if (fromSummaryRef.current) {
      fromSummaryRef.current = false;
      setFlowStep("summary");
      return;
    }
    setFlowStep(advanceFrom(from, forReasons));
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
    const last = advanceFrom(from, lossReasons) === "summary";
    // In the panel the host's Done is the way out, so a step's link never
    // says Done as well — two Done buttons on one screen make you pick.
    if (last && variant === "full") return "Done";
    return from === "serve" || (last && from === "why") ? "Next" : "Skip";
  };

  /**
   * A corrected server flips which mirror chip is legal, so drop the one it
   * no longer offers rather than leave "Weak serve" on a point the rotation
   * now says the opponent served. Runs on the rotation changing under us
   * (a server override anywhere earlier re-anchors every later point), not
   * just on an edit here.
   */
  useEffect(() => {
    setLossReasons((cur) => {
      const kept = pruneLossReasons(cur, iServed);
      if (kept.length === cur.length) return cur;
      void writeDetail({ loss_reasons: kept.length ? kept : null });
      return kept;
    });
  }, [iServed, writeDetail]);

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

  /** Skip reasons still write confirmed_how — that partition is unchanged. */
  const pickSkipReason = (v: string) => {
    setHow(v);
    void writeScorecard({
      confirmed_winner: null,
      confirmed_how: v || null,
      is_let: true,
    });
  };

  /**
   * The misread follow-up: which way the ball went, stored as the same
   * confirmed_how error value it always was. One tap answers it and moves
   * on; tapping the chosen one again clears it.
   */
  const pickMisreadWhere = (v: string) => {
    const next = how === v ? "" : v;
    setHow(next);
    if (outcome === "user" || outcome === "opponent") {
      void writeScorecard({
        confirmed_winner: outcome,
        confirmed_how: next || null,
        is_let: false,
      });
    }
    if (next) goAfter("misread");
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
    // Dropping the misread also drops where-it-went: the detail only ever
    // existed to say WHICH spin was misread, so it can't outlive the claim.
    if (!misreadDetailApplies(next) && how) {
      setHow("");
      if (outcome === "user" || outcome === "opponent") {
        void writeScorecard({
          confirmed_winner: outcome,
          confirmed_how: null,
          is_let: false,
        });
      }
    }
    if (!serveApplies(next) && (serveSpin || serveSide || serveLength)) {
      clearServe();
    }
    if (next.length) settleWhy();
  };

  // Adding a pill: saved to the owner's vocabulary, then applied here. The
  // input stays open on failure so the words aren't lost.
  const [newReason, setNewReason] = useState("");
  const [addingReason, setAddingReason] = useState(false);
  const [savingReason, setSavingReason] = useState(false);

  const submitNewReason = async () => {
    const label = newReason.trim();
    if (!label || !onCreateCustomReason || savingReason) return;
    setSavingReason(true);
    const id = await onCreateCustomReason(label);
    setSavingReason(false);
    if (!id) {
      markError("Couldn't save that reason. Try again.");
      return;
    }
    setNewReason("");
    setAddingReason(false);
    await toggleLossReason(customReasonValue(id));
  };

  // "Who served?" — writes server_override; the ITTF rotation re-anchors
  // from the most recent override, so one fix heals later points too.
  const pickServer = useCallback(
    async (v: "user" | "opponent") => {
      if (serve?.server === v) return; // already showing this server
      markError(null);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ server_override: v })
        .eq("id", point.id);
      if (error) {
        markError("Couldn't save. Tap again.");
        return;
      }
      onPointUpdate({ server_override: v });
      markSaved();
    },
    [serve?.server, point.id, onPointUpdate, markSaved, markError]
  );

  const youLabel = neutral ? mapLabels.you : "Me";
  const themLabel = neutral ? mapLabels.them : "Them";

  // The whole flow is first-person, so it exists only on points the OWNER
  // lost, and never on a neutral third-party match where "you" has no
  // referent. Points you won ask nothing at all: what you did right is not
  // what a player comes back to a match to find out.
  const analysisRelevant = !neutral && outcome === "opponent";

  const customLabels: CustomReasonLabels = useMemo(
    () => new Map(customReasons.map((c) => [c.id, c.label])),
    [customReasons]
  );

  const lossOptions = lossReasonsFor(iServed, customReasons);
  const serverLine = serverContextLine(
    iServed,
    { you: mapLabels.you, them: mapLabels.them },
    neutral
  );
  const lossValueLabel = lossReasonsSummary(lossReasons, customLabels);

  // Where it went — only ever asked about a misread, and it is what turns
  // "I misread it" into "I misread THAT": into the net reads as backspin
  // heavier than you played it, long as topspin, wide as sidespin.
  const misreadRelevant = misreadDetailApplies(lossReasons);
  const misreadValueLabel = howLabel(how);

  // The serve follow-up names sides, because the reason already decided
  // whose serve is in question: their serve beat your return, or yours
  // handed them the point.
  const serveRelevant = serveApplies(lossReasons);
  const servePrompt = lossReasons.includes("weak_serve")
    ? "Which serve did you play?"
    : "Which serve beat you?";
  const serveValueLabel = serveSummaryLabel(serveSpin, serveSide, serveLength);

  // Answers from before migration 060, shown so a match that HAS them does
  // not appear to have lost them. Read-only: these questions are retired, so
  // offering an edit would mean re-opening a step that no longer exists.
  const retiredHowLabel = misreadRelevant ? null : howLabel(how);
  const retiredDirectionLabel = directionLabel(direction);

  // One line standing in for everything recorded, shown on the idle card so
  // you can see what a point holds without opening it.
  const analysisValue =
    [
      analysisRelevant ? lossValueLabel : null,
      misreadRelevant ? misreadValueLabel : null,
      serveRelevant ? serveValueLabel : null,
      retiredHowLabel,
      retiredDirectionLabel,
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
            <h3 className="text-sm font-semibold text-zinc-200">Who served?</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={serve?.server === "user"}
                onClick={() => pickServer("user")}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                  serve?.server === "user"
                    ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                    : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                }`}
              >
                <span className="block truncate">{youLabel}</span>
              </button>
              <button
                type="button"
                aria-pressed={serve?.server === "opponent"}
                onClick={() => pickServer("opponent")}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                  serve?.server === "opponent"
                    ? "border-magenta-glow/60 bg-magenta-glow/15 text-magenta-soft"
                    : "border-edge bg-ink/40 text-zinc-300 hover:border-magenta-glow/40"
                }`}
              >
                <span className="block truncate">{themLabel}</span>
              </button>
            </div>

            <h3 className="mt-5 text-sm font-semibold text-zinc-200">
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
                      onClick={() =>
                        pickSkipReason(how === r.value ? "" : r.value)
                      }
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

            {/* The offer to go deeper, and the record of what's already
                there. Only on points the owner LOST: a point you won has
                nothing here to ask, and a skipped ball never happened. */}
            {analysisRelevant && (
              <div className="mt-5">
                <SummaryRow
                  label="Why I lost it"
                  value={analysisValue}
                  emptyText="Tap to say why"
                  onClick={() => setFlowStep(analysisValue ? "summary" : "why")}
                />
              </div>
            )}

            {/* A point you won can still be carrying retired answers from
                before 060. Show them rather than let them look deleted. */}
            {!analysisRelevant &&
              outcome === "user" &&
              (retiredHowLabel || retiredDirectionLabel) && (
                <div className="mt-5">
                  <SummaryRow
                    label="Recorded earlier"
                    value={[retiredHowLabel, retiredDirectionLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                </div>
              )}
          </motion.div>
        )}

        {/* The analysis questions REPLACE the scoring ones rather than
            stacking under them: one question owns the card at a time, and
            the summary is where you land when they're answered. */}
        {analysisRelevant && (
          <>
            {/* Why you lost it — the question, and now the first thing
                asked. Multi-select, so it stays open across taps and
                settles a beat after you stop tapping. */}
            {step === "why" && (
              <motion.div key="why" {...stepMotion}>
                <StepHeader
                  prompt="Why did you lose it?"
                  optional
                  actionLabel={stepAction("why")}
                  onAction={() => goAfter("why")}
                />
                {/* Who served, stated. The chips are ordered — and the
                    serve chip chosen — off the rotation, so naming it is
                    what makes the list read as reasoned rather than
                    random. */}
                {serverLine && (
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {serverLine}
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {lossOptions.map((r) => (
                    <Chip
                      key={r.value}
                      label={r.label}
                      active={lossReasons.includes(r.value)}
                      onClick={() => void toggleLossReason(r.value)}
                    />
                  ))}
                  {onCreateCustomReason && !addingReason && (
                    <button
                      type="button"
                      onClick={() => setAddingReason(true)}
                      className="rounded-full border border-dashed border-edge bg-transparent px-3.5 py-2 text-xs font-medium text-zinc-500 transition-colors hover:border-cyan-glow/40 hover:text-zinc-300"
                    >
                      Enter custom
                    </button>
                  )}
                </div>
                {/* Your own words, kept for every match: the six cover what
                    players share, not what beat YOU on the day. */}
                {onCreateCustomReason && addingReason && (
                  <div className="mt-2.5 flex gap-2">
                    <input
                      autoFocus
                      value={newReason}
                      maxLength={MAX_CUSTOM_REASON_LEN}
                      onChange={(e) => setNewReason(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitNewReason();
                        }
                        if (e.key === "Escape") {
                          setAddingReason(false);
                          setNewReason("");
                        }
                      }}
                      placeholder="Misread the pips"
                      aria-label="Your own reason"
                      className="min-w-0 flex-1 rounded-full border border-edge bg-ink/40 px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
                    />
                    <span
                      aria-hidden="true"
                      className={`shrink-0 self-center text-[11px] tabular-nums ${
                        newReason.length >= MAX_CUSTOM_REASON_LEN
                          ? "text-amber-300"
                          : "text-zinc-600"
                      }`}
                    >
                      {MAX_CUSTOM_REASON_LEN - newReason.length}
                    </span>
                    <button
                      type="button"
                      disabled={!newReason.trim() || savingReason}
                      onClick={() => void submitNewReason()}
                      className="shrink-0 rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-3.5 py-2 text-xs font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/20 disabled:opacity-40"
                    >
                      {savingReason ? "Adding…" : "Add"}
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {/* Which spin you misread, read backwards off where the ball
                went. Asked only after "Misread the spin". */}
            {step === "misread" && (
              <motion.div key="misread" {...stepMotion}>
                <StepHeader
                  prompt="Where did the ball go?"
                  optional
                  actionLabel={stepAction("misread")}
                  onAction={() => goAfter("misread")}
                />
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {MISREAD_WHERE.map((w) => (
                    <Chip
                      key={w.value}
                      label={w.label}
                      active={how === w.value}
                      onClick={() => pickMisreadWhere(w.value)}
                    />
                  ))}
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

            {step === "summary" && (
              <motion.div key="summary" {...stepMotion} className="space-y-2">
                <SummaryRow
                  label="Why I lost it"
                  value={lossValueLabel}
                  emptyText="Not sure yet"
                  onClick={() => openStepFromSummary("why")}
                />

                {misreadRelevant && (
                  <SummaryRow
                    label="Where it went"
                    value={misreadValueLabel}
                    onClick={() => openStepFromSummary("misread")}
                  />
                )}

                {serveRelevant && (
                  <SummaryRow
                    label="Serve"
                    value={serveValueLabel}
                    onClick={() => openStepFromSummary("serve")}
                  />
                )}

                {/* Answers to questions that no longer exist. Readable so a
                    match that has them doesn't look emptied, with no Edit:
                    there is no step left to open. */}
                {retiredHowLabel && (
                  <SummaryRow label="How it ended" value={retiredHowLabel} />
                )}

                {retiredDirectionLabel && (
                  <SummaryRow
                    label="Placement"
                    value={retiredDirectionLabel}
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
