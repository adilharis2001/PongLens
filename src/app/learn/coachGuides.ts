import type { Guide } from "./catalogTypes.ts";

export const COACH_GROUPS = [
  "Get started",
  "Lesson entries",
  "Match feedback",
  "Paid reviews",
] as const;

export const coachGuides: Guide[] = [
  {
    slug: "coaching-workspace",
    title: "Use the coaching workspace",
    summary: "See students, recent entries, and shared matches in one place.",
    group: "Get started",
    visibility: { audiences: ["coach"], platforms: ["web", "ios"] },
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open the Coaching workspace.",
          "Choose a student from Students.",
          "Review their entries and shared matches.",
        ],
      },
    ],
  },
];
