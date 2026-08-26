export interface ResearchPage {
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly href: `/research/${string}`;
  readonly accent: "cyan" | "magenta";
}

export const RESEARCH_PAGES = [
  {
    title: "Serve spin",
    category: "Data labeling",
    description:
      "Watch each serve and say what spin it carried, beside what the bounce-ratio estimator predicted. Builds the ground truth the spin work needs.",
    href: "/research/spin",
    accent: "cyan",
  },
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
    title: "Serve calls",
    category: "Model evaluation",
    description:
      "The moments the detector called a serve, playable at quarter speed with the table and both bounces drawn on, so the four in ten it gets wrong can be named.",
    href: "/research/serves",
    accent: "magenta",
  },
  {
    title: "Full-match signals",
    category: "Model evaluation",
    description:
      "The Koko and Terry videos uncut, every detected signal on a seekable timeline, for finding where serve and point boundaries actually live.",
    href: "/research/fullmatch",
    accent: "magenta",
  },
  {
    title: "End-on cards",
    category: "Model evaluation",
    description:
      "Thanakorn's and Guillaume's matches, and yours against Gui, re-run with the end-on fallback on, so you can see the cards each one would get now and mark where its points really start and end.",
    href: "/research/endon",
    accent: "magenta",
  },
  {
    title: "Score gaps",
    category: "Model evaluation",
    description:
      "Every match anyone has scored, game by game, with the games that could not have ended on their recorded score and the long gaps where a rally most likely went missing from the cut.",
    href: "/research/scores",
    accent: "cyan",
  },
  {
    title: "Side-on cameras",
    category: "Model evaluation",
    description:
      "The Koko, Terry and Tripp footage, filmed almost from behind the player, with every signal drawn on and the fused cards you split by hand cued for your notes.",
    href: "/research/sidecam",
    accent: "cyan",
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
    title: "Serve accuracy",
    category: "Model evaluation",
    description:
      "Every point beside its clip: where the serve landed, where the rally "
      + "ended, and why a serve was refused when it was.",
    href: "/research/serve-accuracy",
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
  {
    title: "Table calibration",
    category: "Model evaluation",
    description:
      "Every production match with the corners each model proposed, and room to drag the right ones on top so the error can finally be measured.",
    href: "/research/table-calibration",
    accent: "magenta",
  },
  {
    title: "Table calibration holdout",
    category: "Model evaluation",
    description:
      "Frames the detector has never been tuned on, one outline each, for the only test that settles whether it works.",
    href: "/research/table-calibration/holdout",
    accent: "cyan",
  },
] as const satisfies readonly ResearchPage[];

export function hasResearchDashboardAccess(
  isAdmin: boolean,
  reviewerActive: boolean,
): boolean {
  return isAdmin || reviewerActive;
}
