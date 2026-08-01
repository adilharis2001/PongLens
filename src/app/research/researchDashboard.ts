export interface ResearchPage {
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly href: `/research/${string}`;
  readonly accent: "cyan" | "magenta";
}

export const RESEARCH_PAGES = [
  {
    title: "Fused labeling",
    category: "Data labeling",
    description:
      "Review synchronized audio and ball-tracking evidence to produce trusted point labels.",
    href: "/research/fused-labeling",
    accent: "cyan",
  },
  {
    title: "Placement calibration",
    category: "Model calibration",
    description:
      "Compare placement predictions and calibrate how landing locations map onto the table.",
    href: "/research/placement-calibration",
    accent: "magenta",
  },
  {
    title: "Serve detection",
    category: "Model evaluation",
    description:
      "Label serve timing and inspect the latest temporal serve-detection results.",
    href: "/research/serve-detection",
    accent: "cyan",
  },
  {
    title: "Point-ending research",
    category: "Model evaluation",
    description:
      "Review winner-constrained point endings and identify the final decisive contact.",
    href: "/research/winner-constrained-endings",
    accent: "magenta",
  },
] as const satisfies readonly ResearchPage[];

export function hasResearchDashboardAccess(
  isAdmin: boolean,
  reviewerActive: boolean,
): boolean {
  return isAdmin || reviewerActive;
}
