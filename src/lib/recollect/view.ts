import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recollectTopicLabel,
  type RecollectTopicKey,
  type RecollectTopicRow,
  type RecollectView,
} from "./types.ts";

interface TopicRow {
  id: string;
  topic_key: string;
  last_reviewed_at: string | null;
}

interface PointRow {
  topic_id: string;
  lesson_id: string;
}

/**
 * The queue: topics the account holds points for, longest-unopened first.
 *
 * There are no due dates and no intervals. With roughly eight to ten topics,
 * opening one per visit spaces each topic eight to ten visits apart on its
 * own, and the tab always has something in it — which the due-date model
 * could not say.
 */
export function buildTopicQueue(
  topics: TopicRow[],
  points: PointRow[],
): RecollectTopicRow[] {
  const counts = new Map<string, { points: number; lessons: Set<string> }>();
  for (const point of points) {
    const entry = counts.get(point.topic_id) ?? {
      points: 0,
      lessons: new Set<string>(),
    };
    entry.points += 1;
    entry.lessons.add(point.lesson_id);
    counts.set(point.topic_id, entry);
  }

  return topics
    .flatMap((topic) => {
      const count = counts.get(topic.id);
      // A topic whose points were all dismissed, or whose source entry was
      // deleted, drops off the list rather than showing an empty row.
      if (!count || count.points === 0) return [];
      return [
        {
          id: topic.id,
          key: topic.topic_key as RecollectTopicKey,
          label: recollectTopicLabel(topic.topic_key),
          pointCount: count.points,
          lessonCount: count.lessons.size,
          lastReviewedAt: topic.last_reviewed_at,
        },
      ];
    })
    .sort((a, b) => {
      if (a.lastReviewedAt === b.lastReviewedAt) {
        return a.label.localeCompare(b.label);
      }
      if (!a.lastReviewedAt) return -1;
      if (!b.lastReviewedAt) return 1;
      return a.lastReviewedAt < b.lastReviewedAt ? -1 : 1;
    });
}

export async function loadRecollectView(
  ownerId: string,
  suppliedAdmin?: SupabaseClient,
): Promise<RecollectView> {
  const admin =
    suppliedAdmin ??
    (await import("../supabase/admin.ts")).createAdminClient();

  const [preference, jobs, topics, points] = await Promise.all([
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
      .from("recollect_topics")
      .select("id, topic_key, last_reviewed_at")
      .eq("user_id", ownerId),
    admin
      .from("recollect_points")
      .select("topic_id, lesson_id")
      .eq("user_id", ownerId)
      .eq("state", "active"),
  ]);
  if (preference.error) throw preference.error;
  if (jobs.error) throw jobs.error;
  if (topics.error) throw topics.error;
  if (points.error) throw points.error;

  const enabled = preference.data?.enabled !== false;
  const now = Date.now();
  const processing = (jobs.data ?? []).some(
    (job) =>
      job.status === "queued" ||
      job.status === "processing" ||
      (job.status === "failed" &&
        new Date(String(job.available_at)).getTime() <= now),
  );

  return {
    enabled,
    noticeSeen: Boolean(preference.data?.notice_seen_at),
    processing: enabled && processing,
    topics: enabled
      ? buildTopicQueue(
          (topics.data ?? []) as TopicRow[],
          (points.data ?? []) as PointRow[],
        )
      : [],
  };
}
