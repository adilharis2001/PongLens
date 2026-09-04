import type { Guide } from "./catalogTypes.ts";

export const PLAYER_GROUPS = [
  "Get started",
  "Review and score",
  "Your game",
  "Share and export",
] as const;

export const playerGuides: Guide[] = [
  {
    slug: "upload-a-video",
    title: "Upload a match video",
    summary: "Choose a video and start processing your match.",
    group: "Get started",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Upload from Home or Matches.",
          "Choose a video and add any match details you want.",
          "Start processing and return when PongLens says the match is ready.",
        ],
      },
      {
        heading: "On iPhone",
        paragraphs: ["Keep the app open until the upload progress begins."],
        visibility: { audiences: ["player"], platforms: ["ios"] },
      },
    ],
  },
];
