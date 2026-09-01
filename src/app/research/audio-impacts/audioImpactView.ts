import {
  hydrateAudioImpactLabel,
  type AudioImpactHumanEvent,
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
    start_s: Math.max(0, round4(timeS - 1)),
    end_s: Math.min(durationS, round4(timeS + 1)),
  };
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
