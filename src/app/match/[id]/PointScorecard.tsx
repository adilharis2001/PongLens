"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";
import type { MapLabels } from "./PlacementMap";
import {
  DIRECTIONS,
  MISREAD_KINDS,
  SERVE_LENGTHS,
  SERVE_SPINS,
  SKIP_REASONS,
  canonicalHow,
  canonicalSkipReason,
  customReasonValue,
  hasLossAnalysis,
  howLabel,
  lossReasonsFor,
  misreadKindApplies,
  outOfPositionApplies,
  serverContextLine,
  MAX_CUSTOM_REASON_LEN,
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
/**
 * THE QUESTIONS ARE A FORM, NOT A WIZARD.
 *
 * They used to be steps: answer, it advances, each step carrying its own
 * Skip/Next, and the multi-select one waiting 1.4s before moving on. That
 * bought nothing — every question is optional, so there was never a path to
 * guide — and it cost a timer, a summary screen to land on, and two ways of
 * reading the same tap depending on how you got there.
 *
 * Now every question is on screen at once and follow-ups simply APPEAR
 * beneath the reason that earns them. Nothing advances, nothing settles,
 * and the panel's own Done is the only way out, pressable at any moment.
 */

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

type SaveFlash = ReturnType<typeof useSaveFlash>;

/** One read-only line for an answer to a question that no longer
 *  exists — kept so a match that has one doesn't look emptied. */
function SummaryRow({
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
 * A follow-up question, appearing under the reason that asked for it.
 *
 * Owns its own entrance because that IS the affordance: the question was
 * not there a moment ago, and it fading in under your thumb is what tells
 * you it belongs to the chip you just pressed. No header link — every
 * question here is optional and the host's Done is the only way out.
 */
function FollowUp({
  prompt,
  motion: motionProps,
  children,
}: {
  prompt: string;
  motion: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <motion.div className="mt-4" {...motionProps}>
      <span className="text-xs font-semibold text-zinc-300">{prompt}</span>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </motion.div>
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

  // Where they got you (fh/bh/mid) — un-retired by 062 as the single
  // follow-up to "Out of position". On a lost point the old rows already
  // meant this, so no migration was needed.
  const [direction, setDirection] = useState<string>(point.direction ?? "");
  // Which part of the spin beat you: its type, or its amount (062).
  const [misreadKind, setMisreadKind] = useState<string>(
    point.misread_kind ?? ""
  );

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
   * What got you about the spin: its type, or its amount. Toggles — tapping
   * the lit chip clears it — because nothing follows and there is nowhere
   * to advance to.
   */
  const pickMisreadKind = async (v: string) => {
    const prev = misreadKind;
    const next = prev === v ? "" : v;
    setMisreadKind(next);
    const ok = await writeDetail({
      misread_kind: (next || null) as Point["misread_kind"],
    });
    if (!ok) setMisreadKind(prev);
  };

  /** Where they got you, on a point you were out of position for. */
  const pickDirection = async (v: string) => {
    const prev = direction;
    const next = prev === v ? "" : v;
    setDirection(next);
    const ok = await writeDetail({
      direction: (next || null) as Point["direction"],
    });
    if (!ok) setDirection(prev);
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
    // A follow-up cannot outlive the reason that asked it.
    if (!misreadKindApplies(next) && misreadKind) {
      setMisreadKind("");
      void writeDetail({ misread_kind: null });
    }
    if (!outOfPositionApplies(next) && direction) {
      setDirection("");
      void writeDetail({ direction: null });
    }
    if (!serveApplies(next) && (serveSpin || serveSide || serveLength)) {
      clearServe();
    }
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
  //
  // Shares hasLossAnalysis with the hosts that decide whether to mount this
  // component: if the two ever disagreed, one of them would render an empty
  // card. `outcome` rather than point.confirmed_winner because the full
  // variant can change the winner in place, and the questions have to follow
  // that edit before it round-trips.
  const analysisRelevant = hasLossAnalysis(
    { confirmed_winner: outcome === "skip" ? null : outcome, is_let: outcome === "skip" },
    neutral
  );

  const lossOptions = lossReasonsFor(iServed, customReasons);
  const serverLine = serverContextLine(
    iServed,
    { you: mapLabels.you, them: mapLabels.them },
    neutral
  );

  // The two follow-ups, each owned by exactly one reason. Both appear
  // beneath it the moment it is picked and disappear with it — no step to
  // advance to, nothing to dismiss.
  const misreadRelevant = misreadKindApplies(lossReasons);
  const positionRelevant = outOfPositionApplies(lossReasons);

  // The serve follow-up names sides, because the reason already decided
  // whose serve is in question: their serve beat your return, or yours
  // handed them the point.
  const serveRelevant = serveApplies(lossReasons);
  const servePrompt = lossReasons.includes("weak_serve")
    ? "Which serve did you play?"
    : "Which serve beat you?";
  const serveValueLabel = serveSummaryLabel(serveSpin, serveSide, serveLength);

  // Answers to questions that no longer exist, kept readable so a match
  // that HAS them does not appear to have lost them. `how` only lands here
  // now: since 062 nothing writes confirmed_how on a scored point.
  const retiredHowLabel = howLabel(how);

  // How a follow-up arrives; a plain fade when motion is reduced.
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
      {/* Scoring questions: the point sheet asks them, the Keep-score panel
          does not — there the pad's own buttons already did. */}
      {variant === "full" && (
        <div>
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

          {/* Answers to questions that no longer exist, readable so a match
              that has them doesn't look emptied. Nothing writes these now. */}
          {retiredHowLabel && (
            <div className="mt-5">
              <SummaryRow label="Recorded earlier" value={retiredHowLabel} />
            </div>
          )}
        </div>
      )}

      {/* The questions, all on screen at once. A follow-up appears the
          moment its reason is picked and vanishes with it; nothing advances
          and nothing has to be dismissed. */}
      {analysisRelevant && (
        <div className={variant === "full" ? "mt-5" : ""}>
          <span className="text-sm font-semibold text-zinc-200">
            Why did you lose it?
          </span>
          {/* Who served, stated: the chips are ordered — and the serve chip
              chosen — off the rotation, so naming it is what makes the list
              read as reasoned rather than random. */}
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
          {/* Your own words, kept for every match: the built-ins cover what
              players share, not what beat YOU on the day. */}
          {onCreateCustomReason && addingReason && (
            <div className="mt-2.5 flex gap-2">
              <input
                // Explicit type: the iOS no-zoom guard in globals.css keys
                // off input[type="text"], and a bare <input> does not match
                // that selector even though it behaves as one.
                type="text"
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

          {/* Misread the spin -> which part of it beat you. Two chips: a
              reading problem and a touch problem need different practice. */}
          {misreadRelevant && (
            <FollowUp prompt="What got you?" motion={stepMotion}>
              {MISREAD_KINDS.map((k) => (
                <Chip
                  key={k.value}
                  label={k.label}
                  active={misreadKind === k.value}
                  onClick={() => void pickMisreadKind(k.value)}
                />
              ))}
            </FollowUp>
          )}

          {/* Out of position -> where they beat you. Middle is the
              crossover at your elbow, the target nobody drills. */}
          {positionRelevant && (
            <FollowUp prompt="Where did they get you?" motion={stepMotion}>
              {DIRECTIONS.map((d) => (
                <Chip
                  key={d.value}
                  label={d.label}
                  active={direction === d.value}
                  onClick={() => void pickDirection(d.value)}
                />
              ))}
            </FollowUp>
          )}

          {/* Receive error / Weak serve -> describe that serve. Two rows,
              so they simply sit here until you fill what you want to. */}
          {serveRelevant && (
            <FollowUp prompt={servePrompt} motion={stepMotion}>
              <div className="w-full">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Spin
                </p>
                <div className="flex flex-wrap gap-2">
                  {SERVE_SPINS.map((sp) => (
                    <Chip
                      key={sp.value}
                      label={sp.label}
                      active={serveSpin === sp.value}
                      onClick={() => void pickServeSpin(sp.value)}
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
                {serveValueLabel && (
                  <p className="mt-2 text-[11px] text-zinc-600">
                    {serveValueLabel}
                  </p>
                )}
              </div>
            </FollowUp>
          )}
        </div>
      )}

      <div className="mt-3 flex h-4 items-center gap-3 text-xs">
        {flash.saved && <span className="text-emerald-400">Saved</span>}
        {flash.error && <span className="text-red-400">{flash.error}</span>}
      </div>
    </section>
  );
}
