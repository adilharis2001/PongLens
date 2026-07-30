import type { DueRecollectItem } from "./types.ts";

const INTERVAL_DAYS = [3, 7, 14, 30, 60] as const;

export function nextRecollectDue(
  step: number,
  now = new Date(),
): { step: number; nextDueAt: string } {
  const safeStep = Math.max(0, Math.floor(step));
  const days = INTERVAL_DAYS[Math.min(safeStep, INTERVAL_DAYS.length - 1)];
  return {
    step: safeStep + 1,
    nextDueAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
  };
}

function score(item: DueRecollectItem, now: Date): number {
  const overdueDays = Math.max(
    0,
    (now.getTime() - new Date(item.nextDueAt).getTime()) / 86_400_000,
  );
  return (
    item.sourceFrequency * 20 +
    item.priority * 10 +
    Math.min(10, overdueDays)
  );
}

function diverse(
  rows: DueRecollectItem[],
  limit: number,
  now: Date,
): DueRecollectItem[] {
  const sorted = [...rows].sort(
    (a, b) => score(b, now) - score(a, now) || a.id.localeCompare(b.id),
  );
  const picked: DueRecollectItem[] = [];
  const topics = new Set<string>();
  for (const item of sorted) {
    if (picked.length >= limit) break;
    if (!topics.has(item.topicKey)) {
      picked.push(item);
      topics.add(item.topicKey);
    }
  }
  for (const item of sorted) {
    if (picked.length >= limit) break;
    if (!picked.some((candidate) => candidate.id === item.id)) picked.push(item);
  }
  return picked;
}

export function selectDueRecollectItems(
  items: DueRecollectItem[],
  now = new Date(),
  limit = 3,
): DueRecollectItem[] {
  const eligible = items.filter(
    (item) =>
      !item.paused &&
      item.priority >= 0.55 &&
      new Date(item.nextDueAt).getTime() <= now.getTime(),
  );
  const lessons = eligible.filter((item) => item.kind === "lesson");
  const practices = eligible.filter((item) => item.kind === "practice");
  if (lessons.length > 0 && practices.length > 0 && limit >= 3) {
    return [
      ...diverse(lessons, 2, now),
      ...diverse(practices, 1, now),
    ].slice(0, limit);
  }
  return diverse(eligible, limit, now);
}
