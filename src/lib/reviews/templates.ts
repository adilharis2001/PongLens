/**
 * Offering templates. Starting points only: every word is editable in the
 * offering editor, and the coach owns the result. Prices are suggestions.
 *
 * Copy rules apply here because this text ships to offering pages: plain
 * sentences, no sales framing, no em dashes, no subtitles.
 */
import type {
  IntakeQuestion,
  OfferingTemplateKey,
  ReviewSectionDef,
} from "./types";

export interface OfferingTemplate {
  key: OfferingTemplateKey;
  /** Default card art, a 'stock:' key into /img/offerings/. */
  image: string;
  name: string;
  /** One line shown on the template picker card. */
  blurb: string;
  title: string;
  description: string;
  includes: string[];
  price_cents: number;
  turnaround_days: number;
  followup_rounds: number;
  intake_questions: IntakeQuestion[];
  review_sections: ReviewSectionDef[];
}

export const OFFERING_TEMPLATES: OfferingTemplate[] = [
  {
    key: "full_match",
    image: "stock:full-match",
    name: "Full match review",
    blurb: "The whole match, tactics and technique.",
    title: "Full match review",
    description:
      "I watch your full match and break down what decided it. " +
      "You get the patterns behind the score, the points worth " +
      "rewatching, and a clear plan for what to practice next.",
    includes: [
      "Every game reviewed",
      "Strengths to keep leaning on",
      "What is costing you points",
      "Tactical observations",
      "Selected points to rewatch",
      "A practice plan",
    ],
    price_cents: 5000,
    turnaround_days: 5,
    followup_rounds: 1,
    intake_questions: [
      { id: "goal", label: "What do you want out of this review?" },
      {
        id: "opponent",
        label: "Anything I should know about your opponent?",
        optional: true,
      },
      {
        id: "working_on",
        label: "What have you been working on lately?",
        optional: true,
      },
    ],
    review_sections: [
      { key: "summary", label: "Summary" },
      { key: "strengths", label: "Strengths" },
      { key: "costing_points", label: "What is costing you points" },
      { key: "tactics", label: "Tactics" },
      { key: "practice_plan", label: "Practice plan" },
    ],
  },
  {
    key: "serve",
    image: "stock:serve",
    name: "Serve review",
    blurb: "Your service game, serve by serve.",
    title: "Serve review",
    description:
      "A close look at your serves across one match. Where they land, " +
      "what they give away, and which changes matter most.",
    includes: [
      "Every serve situation reviewed",
      "Spin, placement and depth observations",
      "The serves that won and lost you points",
      "Three things to work on",
    ],
    price_cents: 2500,
    turnaround_days: 3,
    followup_rounds: 1,
    intake_questions: [
      { id: "serves", label: "Which serves do you use most?" },
      {
        id: "trouble",
        label: "What happens after your serve that you don't like?",
        optional: true,
      },
    ],
    review_sections: [
      { key: "summary", label: "Summary" },
      { key: "serves", label: "Your serves" },
      { key: "work_ons", label: "What to work on" },
    ],
  },
  {
    key: "receive",
    image: "stock:receive",
    name: "Receive review",
    blurb: "Returns, first touch, and the point after.",
    title: "Receive review",
    description:
      "How you handle serve. I look at your reads, your first touch, " +
      "and what each return sets up for the rest of the point.",
    includes: [
      "Every receive situation reviewed",
      "Reading spin and length",
      "Return choices against each serve",
      "Three things to work on",
    ],
    price_cents: 2500,
    turnaround_days: 3,
    followup_rounds: 1,
    intake_questions: [
      {
        id: "trouble_serves",
        label: "Which serves give you the most trouble?",
      },
      {
        id: "return_game",
        label: "How do you usually try to return?",
        optional: true,
      },
    ],
    review_sections: [
      { key: "summary", label: "Summary" },
      { key: "receives", label: "Your returns" },
      { key: "work_ons", label: "What to work on" },
    ],
  },
  {
    key: "custom",
    image: "stock:custom",
    name: "Custom review",
    blurb: "Start from a blank page.",
    title: "Match review",
    description: "",
    includes: [],
    price_cents: 3000,
    turnaround_days: 4,
    followup_rounds: 1,
    intake_questions: [
      { id: "goal", label: "What do you want out of this review?" },
    ],
    review_sections: [
      { key: "summary", label: "Summary" },
      { key: "notes", label: "Notes" },
    ],
  },
];

export function templateByKey(key: string): OfferingTemplate | undefined {
  return OFFERING_TEMPLATES.find((t) => t.key === key);
}
