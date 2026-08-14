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
  {
    title: "Updated serve detector",
    category: "Model evaluation",
    description:
      "Where the rebuilt serve detector finds the serve, where it goes quiet, and what the ball track and table outline were doing at the time.",
    href: "/research/serve-detector",
    accent: "magenta",
  },
  {
    title: "Point recall",
    category: "Model evaluation",
    description:
      "Whether any real rally loses its card, measured against your own scoring, with the stretches the two systems disagree about cued for a verdict.",
    href: "/research/recall",
    accent: "cyan",
  },
  {
    title: "Crossing review",
    category: "Model evaluation",
    description:
      "Watch the points the zero-crossing junk rule got wrong: the junk it missed and the real points it would have flagged.",
    href: "/research/crossing-review",
    accent: "cyan",
  },
] as const satisfies readonly ResearchPage[];

export function hasResearchDashboardAccess(
  isAdmin: boolean,
  reviewerActive: boolean,
): boolean {
  return isAdmin || reviewerActive;
}
