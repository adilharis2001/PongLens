export const RECOLLECT_PROCESSOR_VERSION = "recollect-v3";
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

export interface BufferedCandidate extends Omit<ExtractedCandidate, "evidence"> {
  /**
   * The source words the cue was built from. Transient: it rides the job's
   * candidate buffer so the quality gate can compare a tidy-sounding cue
   * against the speech it came from, and is dropped before anything is
   * stored on an item. Buffers written by earlier processor versions have
   * no evidence, so this stays optional.
   */
  evidence?: string;
}

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
  /** Whether anything has ever been revealed, so the tab knows to offer the
   *  history without paying for the list itself on first paint. */
  hasHistory: boolean;
}

/**
 * One reminder the player has already looked at. Unlike a card front this
 * carries the cue, because the point of the history is to reread the answer
 * on purpose. Opening it never touches the schedule.
 */
export interface RecollectHistoryEntry {
  id: string;
  question: string;
  cue: string;
  topic: string;
  source: RecollectSource;
  lastRevealedAt: string;
  nextDueAt: string;
  /** How many times it has come back, i.e. how far along the schedule it is. */
  reviewCount: number;
  inWorkingOn: boolean;
}

export interface RecollectHistoryPage {
  entries: RecollectHistoryEntry[];
  hasMore: boolean;
}

export type RecollectAction =
  | { action: "reveal"; itemId: string; reviewKey: string }
  | { action: "dismiss"; itemId: string }
  | { action: "add_to_working_on"; itemId: string }
  | { action: "acknowledge_notice" };
