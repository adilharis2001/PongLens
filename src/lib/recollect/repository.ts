import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin.ts";
import {
  RECOLLECT_PROCESSOR_VERSION,
  type BufferedCandidate,
  type ClaimedRecollectJob,
  type ExistingRecollectItem,
  type RecollectCategory,
  type ValidatedCandidate,
} from "./types.ts";

export interface RecollectRepository {
  claim(ownerId: string): Promise<ClaimedRecollectJob | null>;
  requeueSegment(
    jobId: string,
    nextSegment: number,
    buffer: BufferedCandidate[],
  ): Promise<void>;
  complete(
    job: ClaimedRecollectJob,
    items: ValidatedCandidate[],
  ): Promise<void>;
  fail(jobId: string, attempt: number, message: string): Promise<void>;
  isEnabled(ownerId: string): Promise<boolean>;
  existingByTopics(
    ownerId: string,
    topicKeys: string[],
  ): Promise<ExistingRecollectItem[]>;
}

function claimed(raw: Record<string, unknown>): ClaimedRecollectJob {
  return {
    id: String(raw.id),
    userId: String(raw.user_id),
    lessonId: String(raw.lesson_id),
    contentHash: String(raw.content_hash),
    processorVersion: String(raw.processor_version),
    nextSegment: Number(raw.next_segment),
    candidateBuffer: Array.isArray(raw.candidate_buffer)
      ? (raw.candidate_buffer as BufferedCandidate[])
      : [],
    firstDueAt: String(raw.first_due_at),
    attemptCount: Number(raw.attempt_count),
    transcript: String(raw.transcript),
    kind: raw.kind === "practice" ? "practice" : "lesson",
    sourceCreatedAt: String(raw.source_created_at),
    sourceTitle: raw.source_title ? String(raw.source_title) : null,
  };
}

function completionItem(item: ValidatedCandidate) {
  return {
    question: item.question,
    cue: item.cue,
    topic_key: item.topicKey,
    category: item.category,
    priority: item.priority,
    segment_start: item.segmentStart,
    segment_end: item.segmentEnd,
    evidence_hash: item.evidenceHash,
    duplicate_of: item.duplicateOf,
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

    async requeueSegment(jobId, nextSegment, buffer) {
      const { error } = await admin
        .from("recollect_jobs")
        .update({
          status: "queued",
          next_segment: nextSegment,
          attempt_count: 0,
          candidate_buffer: buffer,
          available_at: new Date().toISOString(),
          locked_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("status", "processing");
      if (error) throw error;
    },

    async complete(job, items) {
      const { error } = await admin.rpc("complete_recollect_job", {
        p_owner_id: job.userId,
        p_job_id: job.id,
        p_content_hash: job.contentHash,
        p_items: items.map(completionItem),
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

    async existingByTopics(ownerId, topicKeys) {
      if (topicKeys.length === 0) return [];
      const { data, error } = await admin
        .from("recollect_items")
        .select("id, question, cue, topic_key, category")
        .eq("user_id", ownerId)
        .eq("state", "active")
        .in("topic_key", [...new Set(topicKeys)].slice(0, 30))
        .limit(20);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: String(row.id),
        question: String(row.question),
        cue: String(row.cue),
        topicKey: String(row.topic_key),
        category: String(row.category) as RecollectCategory,
      }));
    },
  };
}

export async function enqueueRecollectSource(
  ownerId: string,
  lessonId: string,
  firstDueAt: string | null = null,
  admin: SupabaseClient = createAdminClient(),
): Promise<boolean> {
  const { data, error } = await admin.rpc("enqueue_recollect_source", {
    p_owner_id: ownerId,
    p_lesson_id: lessonId,
    p_first_due_at: firstDueAt,
    p_processor_version: RECOLLECT_PROCESSOR_VERSION,
  });
  if (error) throw error;
  return Boolean(data?.queued);
}
