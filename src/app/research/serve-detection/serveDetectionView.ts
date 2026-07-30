import type {
  ServeQueueFilter,
  ServeResearchAssignment,
} from "./types";

export function filterServeAssignments(
  assignments: ServeResearchAssignment[],
  filter: ServeQueueFilter,
): ServeResearchAssignment[] {
  return assignments.filter(
    (assignment) =>
      (filter.match === "all" ||
        assignment.source.match_label === filter.match) &&
      (filter.status === "all" ||
        assignment.source.proposal.detector.status === filter.status),
  );
}

export function serveProgress(
  assignments: ServeResearchAssignment[],
): { completed: number; total: number } {
  return {
    completed: assignments.filter((item) => item.status === "submitted")
      .length,
    total: assignments.length,
  };
}

export function nextUnsubmittedIndex(
  assignments: ServeResearchAssignment[],
  currentIndex: number,
): number {
  if (assignments.length === 0) return 0;
  for (let offset = 1; offset <= assignments.length; offset += 1) {
    const index = (currentIndex + offset) % assignments.length;
    if (assignments[index]?.status !== "submitted") return index;
  }
  return Math.min(currentIndex, assignments.length - 1);
}

export function actionLabel(type: string): string {
  switch (type) {
    case "serve_contact":
      return "Likely serve contact";
    case "serve_first_bounce":
      return "Likely first bounce";
    case "serve_second_bounce":
      return "Likely second bounce";
    case "return_contact":
      return "Likely return contact";
    case "return_bounce":
      return "Likely return bounce";
    default:
      return "Likely action";
  }
}
