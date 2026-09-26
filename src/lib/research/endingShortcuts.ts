/**
 * Keyboard labeling for the point-endings page. The keys map onto exactly the
 * edits the mouse makes (updateBounce / removeBounce / lastBounce), so a key
 * press and a dropdown choice store the same answer.
 */
import {ENDING_REASONS, isRallyBounce, removeBounce, updateBounce, type BounceAnnotation, type BounceKind, type BounceReview, type EndingReason} from './pointEndings.ts';

/** Letter → bounce type. Rally and the older non-playing label are deliberately absent. */
export const KIND_KEYS: readonly (readonly [string, BounceKind])[] = [
  ['t', 'table'], ['s', 'serve'], ['p', 'paddle'], ['f', 'floor'],
  ['n', 'net_bounce'], ['c', 'net_clip'], ['o', 'other_table'], ['h', 'ball_handling'],
  ['d', 'non_rally'], ['u', 'ceiling'], ['x', 'other_non_bounce'],
];
export function kindForKey(key: string): BounceKind | null {
  return KIND_KEYS.find(([k]) => k === key.toLowerCase())?.[1] ?? null;
}
export function keyForKind(kind: BounceKind): string | null {
  return KIND_KEYS.find(([, k]) => k === kind)?.[0].toUpperCase() ?? null;
}

/** 1–9 → ending reason, in the dropdown's order. Custom stays a mouse choice. */
export const REASON_KEYS: readonly (readonly [string, EndingReason])[] =
  ENDING_REASONS.filter(([key]) => key !== 'custom').slice(0, 9).map(([key], i) => [String(i + 1), key] as const);
export function reasonForKey(key: string): EndingReason | null {
  return REASON_KEYS.find(([k]) => k === key)?.[1] ?? null;
}
export function keyForReason(reason: EndingReason): string | null {
  return REASON_KEYS.find(([, r]) => r === reason)?.[0] ?? null;
}

export type BounceStop = {id: string; rawTime: number};
/** Detected and added bounces together, in the order they happen. */
export function bounceOrder(detected: readonly {t: number}[], rawOffset: number, review: BounceReview): BounceStop[] {
  const stops = [
    ...detected.map((b, i) => ({id: `detected:${i}`, rawTime: b.t + rawOffset})),
    ...review.events.filter(e => e.id.startsWith('added:') && e.rawTime !== undefined).map(e => ({id: e.id, rawTime: e.rawTime!})),
  ];
  return stops.sort((a, b) => a.rawTime - b.rawTime || a.id.localeCompare(b.id));
}
/** Next (delta 1) or previous (-1) bounce; from nothing, Tab starts at the first and Shift+Tab at the last. */
export function stepBounce(order: readonly BounceStop[], current: string, delta: 1 | -1): BounceStop | null {
  if (!order.length) return null;
  const i = order.findIndex(s => s.id === current);
  if (i < 0) return delta === 1 ? order[0] : order[order.length - 1];
  return order[Math.min(order.length - 1, Math.max(0, i + delta))];
}

/** Same edit the Event type dropdown makes: keep the shown side, keep an added bounce's time. */
export function withKind(review: BounceReview, shown: BounceReview, stop: BounceStop, kind: BounceKind): BounceReview {
  const side = shown.events.find(e => e.id === stop.id)?.side ?? null;
  const event: BounceAnnotation = {id: stop.id, kind, side, ...(stop.id.startsWith('added:') ? {rawTime: stop.rawTime} : {})};
  return updateBounce(review, event);
}

export type LastBounceResult = {review: BounceReview} | {refused: string} | {dismissSuggestion: true};
/**
 * Toggle the last playable bounce exactly as the checkbox does: it sets or clears
 * the mark only, never accepts a suggested type. An unannotated detected bounce
 * counts as a table bounce; a shown-but-unsaved suggested mark is dismissed.
 */
export function toggleLastBounce(review: BounceReview, shown: BounceReview, id: string): LastBounceResult {
  if (shown.lastBounce === id) return review.lastBounce === id ? {review: {...review, lastBounce: null}} : {dismissSuggestion: true};
  const kind = shown.events.find(e => e.id === id)?.kind ?? 'table';
  if (!isRallyBounce(kind)) return {refused: 'Only a table or serve bounce can be the last playable bounce.'};
  return {review: {...review, lastBounce: id}};
}

export function withoutBounce(review: BounceReview, id: string): BounceReview {
  return removeBounce(review, id);
}

/** Shortcuts stay out of the way while someone is typing or choosing in a field. */
export function typingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const node = el as HTMLElement;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes((node as HTMLInputElement).type);
}
