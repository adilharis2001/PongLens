export const RECOLLECT_PROCESSOR_VERSION = "recollect-topics-v1";
export const RECOLLECT_MODEL = "gpt-5-mini";

/** How many points one open of a topic reveals. Coaching and motor-learning
 *  work is consistent that cutting feedback volume improves retention, so a
 *  topic holding eleven points rotates through them rather than showing a
 *  wall. */
export const RECOLLECT_REVEAL_LIMIT = 5;

/**
 * The closed list. The model assigns to it and never invents a name.
 *
 * Free-form themes drift: the same account produced "Footwork & positioning",
 * "Footwork & weight transfer" and "Stance & balance" for overlapping ground,
 * and "Drills & practice focus" beside "Timing, drills & practice focus".
 * Nothing aggregates across lessons that way, and deduplication turns into
 * fuzzy string matching. Fixed keys also give the tab a stable shelf that
 * does not reshuffle as entries arrive.
 */
export const RECOLLECT_TOPICS = [
  { key: "serve", label: "Serve" },
  { key: "receive", label: "Receive" },
  { key: "forehand", label: "Forehand" },
  { key: "backhand", label: "Backhand" },
  { key: "footwork", label: "Footwork & positioning" },
  { key: "stance", label: "Stance & balance" },
  { key: "transitions", label: "Transitions" },
  { key: "tactics", label: "Point construction" },
  { key: "practice", label: "Drills & practice" },
  { key: "mental", label: "Mental & routine" },
] as const;

export type RecollectTopicKey = (typeof RECOLLECT_TOPICS)[number]["key"];

export const RECOLLECT_TOPIC_KEYS: readonly RecollectTopicKey[] =
  RECOLLECT_TOPICS.map((topic) => topic.key);

export function recollectTopicLabel(key: string): string {
  return (
    RECOLLECT_TOPICS.find((topic) => topic.key === key)?.label ?? "Reminder"
  );
}

/** One theme's worth of source material handed to the model. */
export interface RecollectThemeInput {
  name: string;
  points: string[];
}

/** A point the model sorted onto a topic. Text is copied, not rewritten. */
export interface SortedPoint {
  topicKey: RecollectTopicKey;
  text: string;
  themeName: string | null;
  /** True when it repeats a point the topic already holds. Not stored. */
  duplicate: boolean;
}

export interface ExistingRecollectPoint {
  topicKey: RecollectTopicKey;
  text: string;
}

export interface ClaimedRecollectJob {
  id: string;
  userId: string;
  lessonId: string;
  contentHash: string;
  processorVersion: string;
  attemptCount: number;
  /** Distilled themes when the entry has takeaways. */
  themes: RecollectThemeInput[];
  /** The raw entry when it was too short to be distilled. */
  body: string | null;
  kind: "lesson" | "practice";
}

export interface RecollectSource {
  lessonId: string;
  kind: "lesson" | "practice";
  createdAt: string;
  title: string | null;
}

/** A row in the topic queue. */
export interface RecollectTopicRow {
  id: string;
  key: RecollectTopicKey;
  label: string;
  pointCount: number;
  lessonCount: number;
  lastReviewedAt: string | null;
}

/** A point revealed by opening a topic. */
export interface RevealedPoint {
  id: string;
  text: string;
  inWorkingOn: boolean;
  source: RecollectSource;
}

export interface RecollectView {
  enabled: boolean;
  noticeSeen: boolean;
  processing: boolean;
  topics: RecollectTopicRow[];
}

export type RecollectAction =
  | { action: "open"; topicId: string; reviewKey: string }
  | { action: "dismiss"; pointId: string }
  | { action: "add_to_working_on"; pointId: string }
  | { action: "acknowledge_notice" };
