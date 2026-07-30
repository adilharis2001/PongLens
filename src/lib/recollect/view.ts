import type { SupabaseClient } from "@supabase/supabase-js";
import { selectDueRecollectItems } from "./schedule.ts";
import type {
  DueRecollectItem,
  RecollectCardFront,
  RecollectSource,
  RecollectView,
} from "./types.ts";

interface CardItemRow {
  id: string;
  question: string;
  cue?: string;
  topic_key: string;
}

interface LessonRow {
  id: string;
  kind: string;
  created_at: string;
  takeaways: unknown;
}

interface CardSourceRow {
  item_id: string;
  lesson_id: string;
  lesson: LessonRow;
}

function sourceTitle(takeaways: unknown): string | null {
  if (!takeaways || typeof takeaways !== "object") return null;
  const title = (takeaways as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function topicLabel(topicKey: string): string {
  const value = topicKey.replaceAll(/[_-]+/g, " ").trim();
  return value ? value[0].toUpperCase() + value.slice(1) : "Reminder";
}

function toSource(row: CardSourceRow): RecollectSource {
  return {
    lessonId: row.lesson_id,
    kind: row.lesson.kind === "practice" ? "practice" : "lesson",
    createdAt: row.lesson.created_at,
    title: sourceTitle(row.lesson.takeaways),
  };
}

export function buildRecollectCards(
  items: CardItemRow[],
  sources: CardSourceRow[],
): RecollectCardFront[] {
  const newest = new Map<string, CardSourceRow>();
  for (const source of sources) {
    const current = newest.get(source.item_id);
    if (
      !current ||
      source.lesson.created_at > current.lesson.created_at
    ) {
      newest.set(source.item_id, source);
    }
  }

  return items.flatMap((item) => {
    const source = newest.get(item.id);
    if (!source) return [];
    return [
      {
        id: item.id,
        question: item.question,
        topic: topicLabel(item.topic_key),
        source: toSource(source),
      },
    ];
  });
}

export async function loadRecollectView(
  ownerId: string,
  suppliedAdmin?: SupabaseClient,
  now = new Date(),
): Promise<RecollectView> {
  const admin =
    suppliedAdmin ??
    (await import("../supabase/admin.ts")).createAdminClient();
  const reviewWindowStart = new Date(now.getTime() - 86_400_000).toISOString();
  const [preference, jobs, due, recentReveals] = await Promise.all([
    admin
      .from("recollect_preferences")
      .select("enabled, notice_seen_at")
      .eq("user_id", ownerId)
      .maybeSingle(),
    admin
      .from("recollect_jobs")
      .select("status, available_at, attempt_count")
      .eq("user_id", ownerId)
      .in("status", ["queued", "processing", "failed"])
      .lt("attempt_count", 4),
    admin
      .from("recollect_items")
      .select(
        "id, question, cue, topic_key, priority, source_frequency, next_due_at, focus_point_id",
      )
      .eq("user_id", ownerId)
      .eq("state", "active")
      .lte("next_due_at", now.toISOString())
      .order("next_due_at")
      .limit(40),
    admin
      .from("recollect_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ownerId)
      .gte("last_revealed_at", reviewWindowStart),
  ]);
  if (preference.error) throw preference.error;
  if (jobs.error) throw jobs.error;
  if (due.error) throw due.error;
  if (recentReveals.error) throw recentReveals.error;

  const enabled = preference.data?.enabled !== false;
  const processing = (jobs.data ?? []).some(
    (job) =>
      job.status === "queued" ||
      job.status === "processing" ||
      (job.status === "failed" &&
        new Date(String(job.available_at)).getTime() <= now.getTime()),
  );
  const rows = due.data ?? [];
  if (!enabled || rows.length === 0) {
    return {
      enabled,
      noticeSeen: Boolean(preference.data?.notice_seen_at),
      processing: enabled && processing,
      cards: [],
    };
  }

  const itemIds = rows.map((row) => String(row.id));
  const sourceResult = await admin
    .from("recollect_item_sources")
    .select("item_id, lesson_id")
    .in("item_id", itemIds);
  if (sourceResult.error) throw sourceResult.error;
  const lessonIds = [
    ...new Set((sourceResult.data ?? []).map((row) => String(row.lesson_id))),
  ];
  const lessonResult = lessonIds.length
    ? await admin
        .from("lessons")
        .select("id, kind, created_at, takeaways")
        .eq("user_id", ownerId)
        .in("id", lessonIds)
    : { data: [], error: null };
  if (lessonResult.error) throw lessonResult.error;

  const lessons = new Map(
    (lessonResult.data ?? []).map((lesson) => [
      String(lesson.id),
      lesson as LessonRow,
    ]),
  );
  const sources: CardSourceRow[] = (sourceResult.data ?? []).flatMap((row) => {
    const lesson = lessons.get(String(row.lesson_id));
    return lesson
      ? [
          {
            item_id: String(row.item_id),
            lesson_id: String(row.lesson_id),
            lesson,
          },
        ]
      : [];
  });
  const sourceByItem = new Map<string, CardSourceRow>();
  for (const source of sources) {
    const current = sourceByItem.get(source.item_id);
    if (
      !current ||
      source.lesson.created_at > current.lesson.created_at
    ) {
      sourceByItem.set(source.item_id, source);
    }
  }
  const candidates: DueRecollectItem[] = rows.flatMap((row) => {
    const source = sourceByItem.get(String(row.id));
    if (!source) return [];
    return [
      {
        id: String(row.id),
        kind: source.lesson.kind === "practice" ? "practice" : "lesson",
        topicKey: String(row.topic_key),
        sourceFrequency: Number(row.source_frequency),
        priority: Number(row.priority),
        nextDueAt: String(row.next_due_at),
        paused: Boolean(row.focus_point_id),
      },
    ];
  });
  const remaining = Math.max(0, 3 - (recentReveals.count ?? 0));
  const selected = selectDueRecollectItems(candidates, now, remaining);
  const selectedIds = new Set(selected.map((item) => item.id));
  const selectedRows = rows
    .filter((row) => selectedIds.has(String(row.id)))
    .sort(
      (a, b) =>
        selected.findIndex((item) => item.id === String(a.id)) -
        selected.findIndex((item) => item.id === String(b.id)),
    )
    .map((row) => ({
      id: String(row.id),
      question: String(row.question),
      topic_key: String(row.topic_key),
    }));

  return {
    enabled,
    noticeSeen: Boolean(preference.data?.notice_seen_at),
    processing,
    cards: buildRecollectCards(selectedRows, sources),
  };
}
