import {
  hydrateAudioImpactLabel,
  type AudioImpactHumanEvent,
  type AudioImpactHumanLabel,
} from "../../../lib/research/audioImpacts.ts";
import type {
  AudioImpactResearchAssignment,
  AudioImpactRound,
  AudioImpactVenueCategory,
} from "./types";

export interface AudioImpactReviewTarget {
  assignment_id: string;
  event_id: string;
}

export interface AudioImpactFilters {
  venue: AudioImpactVenueCategory | "all";
  round: AudioImpactRound | "all";
  completion: "all" | "open" | "complete";
}

export interface AudioImpactLoopWindow {
  start_s: number;
  end_s: number;
}

export interface AudioImpactTimedEvent {
  id: string;
  time_s: number;
}

export type AudioImpactAuditionPhase = "approaching" | "target" | "after";
export type AudioImpactAuditionMode = "spotlight" | "nearby" | "full";

export type AudioImpactMediaState = "loading" | "ready" | "error";
export type AudioImpactSaveState = "idle" | "saving" | "saved" | "error";

export function canReviewAudioImpact(
  mediaState: AudioImpactMediaState,
  saveState: AudioImpactSaveState,
): boolean {
  return mediaState === "ready" && saveState !== "saving" && saveState !== "error";
}

export function canClassifyAudioImpact(options: {
  media_state: AudioImpactMediaState;
  save_state: AudioImpactSaveState;
  editable: boolean;
  audition_mode: AudioImpactAuditionMode;
  event_id: string;
  heard_event_id: string | null;
}): boolean {
  return (
    canReviewAudioImpact(options.media_state, options.save_state) &&
    options.editable &&
    options.audition_mode === "spotlight" &&
    options.heard_event_id === options.event_id
  );
}

export function shouldReloadAudioImpactMedia(
  currentAssignmentId: string | null,
  nextAssignmentId: string,
): boolean {
  return currentAssignmentId !== nextAssignmentId;
}

interface OrderedReviewEvent extends AudioImpactReviewTarget {
  event: AudioImpactHumanEvent;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function orderedReviewEvents(
  assignments: readonly AudioImpactResearchAssignment[],
): OrderedReviewEvent[] {
  return [...assignments]
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap((assignment) => {
      const label = hydrateAudioImpactLabel(
        assignment.human_label,
        assignment.source.proposal.audio.candidates,
      );
      return [...label.events]
        .sort(
          (left, right) =>
            left.time_s - right.time_s || left.id.localeCompare(right.id),
        )
        .map((event) => ({
          assignment_id: assignment.id,
          event_id: event.id,
          event,
        }));
    });
}

function targetOf(event: OrderedReviewEvent): AudioImpactReviewTarget {
  return {
    assignment_id: event.assignment_id,
    event_id: event.event_id,
  };
}

export function candidateLoop(
  timeS: number,
  durationS: number,
): AudioImpactLoopWindow {
  return {
    start_s: Math.max(0, round4(timeS - 0.75)),
    end_s: Math.min(durationS, round4(timeS + 0.75)),
  };
}

export function candidateSpotlight(
  events: readonly AudioImpactTimedEvent[],
  eventId: string,
  durationS: number,
): AudioImpactLoopWindow {
  const ordered = [...events].sort(
    (left, right) => left.time_s - right.time_s || left.id.localeCompare(right.id),
  );
  const index = ordered.findIndex((event) => event.id === eventId);
  if (index < 0) return { start_s: 0, end_s: Math.min(durationS, 0.38) };

  const target = ordered[index];
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  const previousBoundary = previous
    ? round4((previous.time_s + target.time_s) / 2)
    : 0;
  const nextBoundary = next
    ? round4((target.time_s + next.time_s) / 2)
    : durationS;

  return {
    start_s: Math.max(0, round4(target.time_s - 0.16), previousBoundary),
    end_s: Math.min(durationS, round4(target.time_s + 0.22), nextBoundary),
  };
}

export function audioImpactAuditionGain(
  currentTimeS: number,
  targetTimeS: number,
): number {
  const offset = currentTimeS - targetTimeS;
  if (offset >= -0.055 && offset <= 0.085) return 1;
  if (offset <= -0.12 || offset >= 0.16) return 0.12;
  if (offset < -0.055) {
    return 0.12 + ((offset + 0.12) / 0.065) * 0.88;
  }
  return 1 - ((offset - 0.085) / 0.075) * 0.88;
}

export function audioImpactAuditionPhase(
  currentTimeS: number,
  targetTimeS: number,
): AudioImpactAuditionPhase {
  if (currentTimeS < targetTimeS - 0.055) return "approaching";
  if (currentTimeS <= targetTimeS + 0.085) return "target";
  return "after";
}

export function firstReviewTarget(
  assignments: readonly AudioImpactResearchAssignment[],
): AudioImpactReviewTarget | null {
  const events = orderedReviewEvents(assignments);
  const firstUnresolved = events.find((item) => item.event.kind === null);
  return firstUnresolved ? targetOf(firstUnresolved) : events[0] ? targetOf(events[0]) : null;
}

export function nextReviewTarget(
  assignments: readonly AudioImpactResearchAssignment[],
  assignmentId: string,
  eventId: string,
): AudioImpactReviewTarget | null {
  const events = orderedReviewEvents(assignments);
  const currentIndex = events.findIndex(
    (item) =>
      item.assignment_id === assignmentId && item.event_id === eventId,
  );
  if (currentIndex < 0) return firstReviewTarget(assignments);
  const next = events
    .slice(currentIndex + 1)
    .find((item) => item.event.kind === null);
  return next ? targetOf(next) : null;
}

export function nextReviewTargetInPoint(
  assignments: readonly AudioImpactResearchAssignment[],
  assignmentId: string,
  eventId: string,
): AudioImpactReviewTarget | null {
  const events = orderedReviewEvents(assignments).filter(
    (item) => item.assignment_id === assignmentId,
  );
  const currentIndex = events.findIndex((item) => item.event_id === eventId);
  if (currentIndex < 0) return null;
  const next = events
    .slice(currentIndex + 1)
    .find((item) => item.event.kind === null);
  return next ? targetOf(next) : null;
}

export function pointReviewState(label: AudioImpactHumanLabel): {
  answered: number;
  total: number;
  complete: boolean;
} {
  const answered = label.events.filter((event) => event.kind !== null).length;
  const total = label.events.length;
  return { answered, total, complete: total > 0 && answered === total };
}

export function roundPointPosition(
  assignments: readonly AudioImpactResearchAssignment[],
  assignmentId: string,
): { number: number; total: number } {
  const current = assignments.find((item) => item.id === assignmentId);
  if (!current) return { number: 0, total: 0 };
  const roundAssignments = assignments
    .filter(
      (item) => item.source.prefill.round === current.source.prefill.round,
    )
    .sort((left, right) => left.sequence - right.sequence);
  return {
    number: roundAssignments.findIndex((item) => item.id === assignmentId) + 1,
    total: roundAssignments.length,
  };
}

export function nextOpenPointTarget(
  assignments: readonly AudioImpactResearchAssignment[],
  currentAssignmentId: string,
): AudioImpactReviewTarget | null {
  const current = assignments.find((item) => item.id === currentAssignmentId);
  if (!current) return null;
  const open = assignments
    .filter(
      (item) =>
        item.id !== currentAssignmentId && item.status !== "submitted",
    )
    .sort((left, right) => left.sequence - right.sequence);
  const later = open.filter((item) => item.sequence > current.sequence);
  const nextAssignment = later[0] ?? open[0];
  return nextAssignment ? firstReviewTarget([nextAssignment]) : null;
}

export interface FullContextPlaybackEvidence {
  started_at_zero: boolean;
  invalidated: boolean;
  playback_rate: number;
  current_time_s: number;
  duration_s: number;
}

export function isVerifiedFullContextPlayback(
  evidence: FullContextPlaybackEvidence,
): boolean {
  return (
    evidence.started_at_zero &&
    !evidence.invalidated &&
    evidence.playback_rate === 1 &&
    Number.isFinite(evidence.duration_s) &&
    evidence.duration_s > 0 &&
    evidence.current_time_s >= evidence.duration_s - 0.05
  );
}

export function previousReviewTarget(
  assignments: readonly AudioImpactResearchAssignment[],
  assignmentId: string,
  eventId: string,
): AudioImpactReviewTarget | null {
  const events = orderedReviewEvents(assignments);
  const currentIndex = events.findIndex(
    (item) =>
      item.assignment_id === assignmentId && item.event_id === eventId,
  );
  return currentIndex > 0 ? targetOf(events[currentIndex - 1]) : null;
}

export function previousReviewTargetInPoint(
  assignments: readonly AudioImpactResearchAssignment[],
  assignmentId: string,
  eventId: string,
): AudioImpactReviewTarget | null {
  const events = orderedReviewEvents(assignments).filter(
    (item) => item.assignment_id === assignmentId,
  );
  const currentIndex = events.findIndex((item) => item.event_id === eventId);
  return currentIndex > 0 ? targetOf(events[currentIndex - 1]) : null;
}

export function filterAudioImpactAssignments(
  assignments: readonly AudioImpactResearchAssignment[],
  filters: AudioImpactFilters,
): AudioImpactResearchAssignment[] {
  return assignments.filter(
    (assignment) =>
      (filters.venue === "all" ||
        assignment.source.prefill.venue_category === filters.venue) &&
      (filters.round === "all" ||
        assignment.source.prefill.round === filters.round) &&
      (filters.completion === "all" ||
        (filters.completion === "complete"
          ? assignment.status === "submitted"
          : assignment.status !== "submitted")),
  );
}

export function queueWithActive(
  visible: readonly AudioImpactResearchAssignment[],
  active: AudioImpactResearchAssignment | null,
): AudioImpactResearchAssignment[] {
  if (!active || visible.some((assignment) => assignment.id === active.id)) {
    return [...visible];
  }
  return [active, ...visible];
}
