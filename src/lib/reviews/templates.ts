/**
 * Offering templates. Starting points only: every word is editable in the
 * offering editor, and the coach owns the result. Prices are suggestions.
 *
 * Written in the vocabulary the product actually uses, because a coach
 * reads these once on the storefront and then lives inside the workspace.
 * A review is two things there: PATTERNS (each named, with the points that
 * show it, and optionally a drawing or a voice note) and the WRITE-UP (the
 * sections). An `includes` line that says "selected points to rewatch"
 * describes neither. One that says "5 to 7 patterns, each with the points
 * that show it" describes exactly what lands in the student's inbox.
 *
 * `suggested_patterns` is the half that used to be missing. Templates
 * shaped the storefront and then evaporated; these names reach into the
 * workspace as faded chips the coach can take, rename or ignore. Students
 * never see them.
 *
 * Prices sit roughly a fifth under what an established club charges for
 * the same work, because a coach here is unknown to the buyer at first.
 *
 * Copy rules apply: plain sentences, no sales framing, no em dashes, no
 * subtitles. This text ships to public offering pages.
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
  /** Pattern names offered to the coach in the workspace. Coach only. */
  suggested_patterns: string[];
}

export const OFFERING_TEMPLATES: OfferingTemplate[] = [
  {
    key: "first_look",
    image: "stock:first-look",
    name: "First look",
    blurb: "One thing to change, shown on the video.",
    title: "First look",
    description:
      "A short review for anyone who has never had one. I find the " +
      "habit that is costing you the most, show you the points where " +
      "it happens, and give you one thing to take to practice.",
    includes: [
      "2 patterns, each with the points that show it",
      "A voice note on the one that matters most",
      "A short write-up with one thing to change",
      "One follow-up question",
    ],
    price_cents: 2000,
    turnaround_days: 2,
    followup_rounds: 1,
    intake_questions: [
      { id: "level", label: "How long have you been playing?" },
      {
        id: "goal",
        label: "Is there anything in particular you want me to look at?",
        optional: true,
      },
    ],
    review_sections: [
      { key: "what_i_saw", label: "What I saw" },
      { key: "one_thing", label: "The one thing to change" },
    ],
    suggested_patterns: [
      "The habit costing you the most",
      "Something you already do well",
    ],
  },
  {
    key: "full_match",
    image: "stock:full-match",
    name: "Full match review",
    blurb: "The whole match, in patterns.",
    title: "Full match review",
    description:
      "I watch your whole match and pull out the patterns behind the " +
      "score. Each one gets named, with the points that show it, so you " +
      "can see the habit rather than take my word for it. The write-up " +
      "says what to do about them.",
    includes: [
      "5 to 7 patterns, each with the points that show it",
      "A drawing on the frames that need one",
      "A voice note on the pattern that matters most",
      "A write-up covering what is working and what is costing you",
      "A practice plan for the next two weeks",
      "One follow-up question",
    ],
    price_cents: 5500,
    turnaround_days: 5,
    followup_rounds: 1,
    intake_questions: [
      { id: "level", label: "What level do you play at, roughly?" },
      {
        id: "plan",
        label: "What was your plan going into this match?",
        optional: true,
      },
      {
        id: "opponent",
        label: "Anything I should know about your opponent?",
        optional: true,
      },
    ],
    review_sections: [
      { key: "summary", label: "Summary" },
      { key: "working", label: "What is working" },
      { key: "costing_points", label: "What is costing you points" },
      { key: "practice_plan", label: "Practice plan" },
    ],
    suggested_patterns: [
      "Your serve into the third ball",
      "Your receive into the fourth ball",
      "Where the rallies turn",
      "The score moments",
    ],
  },
  {
    key: "serve_receive",
    image: "stock:serve",
    name: "Serve and receive",
    blurb: "The first four balls of every point.",
    title: "Serve and receive",
    description:
      "Most points are decided in the first four balls. I look at what " +
      "your serve sets up, what your opponent does with it, how you " +
      "handle theirs, and what you get to play on the ball after.",
    includes: [
      "3 to 5 patterns across your serve and your receive",
      "The points that show each one",
      "A drawing on the contact that matters",
      "A write-up on the first four balls",
      "One follow-up question",
    ],
    price_cents: 3000,
    turnaround_days: 3,
    followup_rounds: 1,
    intake_questions: [
      { id: "serves", label: "Which serves do you use most?" },
      {
        id: "trouble",
        label: "Which serves give you the most trouble to return?",
        optional: true,
      },
    ],
    review_sections: [
      { key: "summary", label: "Summary" },
      { key: "serves", label: "Your serve" },
      { key: "receives", label: "Your receive" },
      { key: "work_ons", label: "What to practise" },
    ],
    suggested_patterns: [
      "What your serve gives away",
      "The serve that wins you points",
      "Your first touch on receive",
      "The fourth ball after you receive",
    ],
  },
  {
    key: "opponent",
    image: "stock:opponent",
    name: "Opponent scout",
    blurb: "Someone you are about to play.",
    title: "Opponent scout",
    description:
      "Send me a match with the player you are about to face in it. I " +
      "work out how they serve, how they actually win their points, and " +
      "what they would rather not deal with, then write you a game plan.",
    includes: [
      "3 to 4 patterns in their game, with the points that show them",
      "A voice note walking through the game plan",
      "A write-up of what to do and what to avoid",
      "One follow-up question",
    ],
    price_cents: 3500,
    turnaround_days: 3,
    followup_rounds: 1,
    intake_questions: [
      { id: "who", label: "Which player should I be watching?" },
      { id: "when", label: "When do you play them?" },
      {
        id: "history",
        label: "Have you played them before, and how did it go?",
        optional: true,
      },
    ],
    review_sections: [
      { key: "their_serve", label: "How they serve" },
      { key: "their_points", label: "How they win points" },
      { key: "game_plan", label: "Your game plan" },
    ],
    suggested_patterns: [
      "Their serve, and what it sets up",
      "How they win their points",
      "What they do under pressure",
      "What they would rather not deal with",
    ],
  },
  {
    key: "style",
    image: "stock:style",
    name: "The style you struggle with",
    blurb: "Choppers, pips, blockers, lefties.",
    title: "Playing an awkward style",
    description:
      "Some players are a puzzle rather than a level. Send me a match " +
      "against the style you keep losing to and I will show you what is " +
      "happening on the balls that go wrong, and what to do instead.",
    includes: [
      "3 to 5 patterns in how you handle this style",
      "The points that show each one",
      "A drawing on the shot that keeps going wrong",
      "A write-up with what to change and two drills",
      "One follow-up question",
    ],
    price_cents: 3500,
    turnaround_days: 4,
    followup_rounds: 1,
    intake_questions: [
      {
        id: "style",
        label:
          "What style are they? Chopper, long pips, blocker, lefty, " +
          "something else?",
      },
      {
        id: "feels",
        label: "What does it feel like when it goes wrong?",
        optional: true,
      },
    ],
    review_sections: [
      { key: "happening", label: "What is happening" },
      { key: "change", label: "What to change" },
      { key: "drills", label: "Two drills" },
    ],
    suggested_patterns: [
      "Your first ball against them",
      "The shot that keeps going wrong",
      "When it does work",
    ],
  },
  {
    key: "custom",
    image: "stock:custom",
    name: "From scratch",
    blurb: "Nothing filled in.",
    title: "",
    description: "",
    includes: [],
    price_cents: 3000,
    turnaround_days: 4,
    followup_rounds: 1,
    intake_questions: [
      { id: "goal", label: "What do you want out of this review?" },
    ],
    review_sections: [{ key: "notes", label: "Notes" }],
    suggested_patterns: [],
  },
];

export function templateByKey(key: string): OfferingTemplate | undefined {
  return OFFERING_TEMPLATES.find((t) => t.key === key);
}

/**
 * Every picture that ships, for the image picker. Wider than the template
 * list on purpose: 'stock:receive' belongs to a template that no longer
 * exists, and a coach who chose it should not lose it from the strip the
 * day they open their own offering to change a price.
 */
export const STOCK_IMAGES: string[] = [
  ...OFFERING_TEMPLATES.map((t) => t.image),
  "stock:receive",
];
