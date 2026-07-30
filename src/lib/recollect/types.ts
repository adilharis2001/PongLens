export const RECOLLECT_PROCESSOR_VERSION = "recollect-v1";
export const RECOLLECT_MODEL = "gpt-5-mini";

export type RecollectCategory =
  | "technique"
  | "tactics"
  | "positioning"
  | "serve_receive"
  | "practice"
  | "mental";

export interface RecollectSegment {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface ExtractedCandidate {
  id: string;
  question: string;
  cue: string;
  topicKey: string;
  category: RecollectCategory;
  priority: number;
  evidence: string;
  evidenceHash: string;
  segmentStart: number;
  segmentEnd: number;
}

export type BufferedCandidate = Omit<ExtractedCandidate, "evidence">;

export interface ValidatedCandidate extends BufferedCandidate {
  duplicateOf: string | null;
}

export interface ExistingRecollectItem {
  id: string;
  question: string;
  cue: string;
  topicKey: string;
  category: RecollectCategory;
}

export interface DueRecollectItem {
  id: string;
  kind: "lesson" | "practice";
  topicKey: string;
  sourceFrequency: number;
  priority: number;
  nextDueAt: string;
  paused: boolean;
}

export interface ClaimedRecollectJob {
  id: string;
  userId: string;
  lessonId: string;
  contentHash: string;
  processorVersion: string;
  nextSegment: number;
  candidateBuffer: BufferedCandidate[];
  firstDueAt: string;
  attemptCount: number;
  transcript: string;
  kind: "lesson" | "practice";
  sourceCreatedAt: string;
  sourceTitle: string | null;
}

export interface RecollectSource {
  lessonId: string;
  kind: "lesson" | "practice";
  createdAt: string;
  title: string | null;
}

export interface RecollectCardFront {
  id: string;
  question: string;
  topic: string;
  source: RecollectSource;
}

export interface RecollectView {
  enabled: boolean;
  noticeSeen: boolean;
  processing: boolean;
  cards: RecollectCardFront[];
}

export type RecollectAction =
  | { action: "reveal"; itemId: string; reviewKey: string }
  | { action: "dismiss"; itemId: string }
  | { action: "add_to_working_on"; itemId: string }
  | { action: "acknowledge_notice" };
