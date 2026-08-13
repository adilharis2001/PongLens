import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin.ts";
import {
  RECOLLECT_PROCESSOR_VERSION,
  type ClaimedRecollectJob,
  type ExistingRecollectPoint,
  type RecollectThemeInput,
  type RecollectTopicKey,
  type SortedPoint,
} from "./types.ts";

export interface RecollectRepository {
  claim(ownerId: string): Promise<ClaimedRecollectJob | null>;
  complete(job: ClaimedRecollectJob, points: SortedPoint[]): Promise<void>;
  fail(jobId: string, attempt: number, message: string): Promise<void>;
  isEnabled(ownerId: string): Promise<boolean>;
  existingPoints(ownerId: string): Promise<ExistingRecollectPoint[]>;
}

function themes(raw: unknown): RecollectThemeInput[] {
  const value = raw != null && typeof raw === "object" ? raw : {};
  const list = (value as Record<string, unknown>).themes;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const theme = entry != null && typeof entry === "object" ? entry : {};
    const name = String(
      (theme as Record<string, unknown>).name ?? "",
    ).trim();
    const points = (theme as Record<string, unknown>).points;
    const texts = Array.isArray(points)
      ? points.map((point) => String(point).trim()).filter(Boolean)
      : [];
    return name && texts.length > 0 ? [{ name, points: texts }] : [];
  });
}

function claimed(raw: Record<string, unknown>): ClaimedRecollectJob {
  return {
    id: String(raw.id),
    userId: String(raw.user_id),
    lessonId: String(raw.lesson_id),
    contentHash: String(raw.content_hash),
    processorVersion: String(raw.processor_version),
    attemptCount: Number(raw.attempt_count),
    themes: themes(raw.takeaways),
    body: raw.body ? String(raw.body) : null,
    kind: raw.kind === "practice" ? "practice" : "lesson",
  };
}

export function createRecollectRepository(
  admin: SupabaseClient = createAdminClient(),
): RecollectRepository {
  return {
    async claim(ownerId) {
      const { data, error } = await admin.rpc("claim_recollect_job", {
        p_owner_id: ownerId,
      });
      if (error) throw error;
      return data && typeof data === "object"
        ? claimed(data as Record<string, unknown>)
        : null;
    },

    async complete(job, points) {
      const { error } = await admin.rpc("complete_recollect_job", {
        p_owner_id: job.userId,
        p_job_id: job.id,
        p_content_hash: job.contentHash,
        p_points: points.map((point) => ({
          topic_key: point.topicKey,
          text: point.text,
          theme_name: point.themeName,
          duplicate: point.duplicate,
        })),
      });
      if (error) throw error;
    },

    async fail(jobId, attempt, message) {
      const retryMinutes = [1, 5, 30][Math.max(0, attempt - 1)] ?? null;
      const availableAt =
        retryMinutes == null
          ? "9999-12-31T23:59:59.000Z"
          : new Date(Date.now() + retryMinutes * 60_000).toISOString();
      const { error } = await admin
        .from("recollect_jobs")
        .update({
          status: "failed",
          available_at: availableAt,
          locked_at: null,
          last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      if (error) throw error;
    },

    async isEnabled(ownerId) {
      const { data, error } = await admin
        .from("recollect_preferences")
        .select("enabled")
        .eq("user_id", ownerId)
        .maybeSingle();
      if (error) throw error;
      return data?.enabled !== false;
    },

    /** What the account already holds, so the sort can spot repeats. Points
     *  are short and an account holds tens of them, not thousands. */
    async existingPoints(ownerId) {
      const { data, error } = await admin
        .from("recollect_points")
        .select("text, recollect_topics!inner(topic_key)")
        .eq("user_id", ownerId)
        .eq("state", "active")
        .limit(200);
      if (error) throw error;
      return (data ?? []).flatMap((row) => {
        const topic = row.recollect_topics as unknown as
          | { topic_key?: string }
          | { topic_key?: string }[]
          | null;
        const key = Array.isArray(topic) ? topic[0]?.topic_key : topic?.topic_key;
        return key
          ? [{ topicKey: key as RecollectTopicKey, text: String(row.text) }]
          : [];
      });
    },
  };
}

export async function enqueueRecollectSource(
  ownerId: string,
  lessonId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<boolean> {
  const { data, error } = await admin.rpc("enqueue_recollect_source", {
    p_owner_id: ownerId,
    p_lesson_id: lessonId,
    p_processor_version: RECOLLECT_PROCESSOR_VERSION,
  });
  if (error) throw error;
  return Boolean(data?.queued);
}
