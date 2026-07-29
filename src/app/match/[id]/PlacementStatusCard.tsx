"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  placementRetryView,
  type PlacementRetryView,
} from "@/lib/placement/placementRetry";
import { createClient } from "@/lib/supabase/client";
import type { MatchPlacementStatus } from "@/lib/types";

interface PlacementStatusCardProps {
  matchId: string;
  initialStatus: MatchPlacementStatus;
  retryCount: 0 | 1;
  expiresAt: string | null;
  isOwner: boolean;
  onStatusChange: (status: MatchPlacementStatus) => void;
}

interface PlacementLifecycleRow {
  placement_status: MatchPlacementStatus;
  placement_retry_count: 0 | 1;
  placement_retry_expires_at: string | null;
}

const RETRY_ERROR_COPY: Record<string, string> = {
  source_expired:
    "The original recording is no longer available for another processing attempt.",
  retry_already_used: "The one-time placement retry has already been used.",
  retry_unavailable: "This placement retry is no longer available.",
  match_not_found: "We couldn't find this match.",
  not_owner: "Only the match owner can request another placement attempt.",
  not_authenticated: "Please sign in again before requesting another attempt.",
};

function toneClasses(tone: PlacementRetryView["tone"]) {
  if (tone === "warning") {
    return "border-amber-400/30 bg-amber-400/10";
  }
  if (tone === "progress") {
    return "border-cyan-glow/30 bg-cyan-glow/10";
  }
  return "border-edge bg-surface-2/40";
}

export function PlacementStatusCard({
  matchId,
  initialStatus,
  retryCount,
  expiresAt,
  isOwner,
  onStatusChange,
}: PlacementStatusCardProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [count, setCount] = useState(retryCount);
  const [expiry, setExpiry] = useState(expiresAt);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshedTerminal = useRef<MatchPlacementStatus | null>(null);

  useEffect(() => setStatus(initialStatus), [initialStatus]);
  useEffect(() => setCount(retryCount), [retryCount]);
  useEffect(() => setExpiry(expiresAt), [expiresAt]);

  const updateLifecycle = useCallback(
    (row: PlacementLifecycleRow) => {
      setStatus(row.placement_status);
      setCount(row.placement_retry_count);
      setExpiry(row.placement_retry_expires_at);
      onStatusChange(row.placement_status);

      if (
        (row.placement_status === "ready"
          || row.placement_status === "final_failed")
        && refreshedTerminal.current !== row.placement_status
      ) {
        refreshedTerminal.current = row.placement_status;
        router.refresh();
      }
    },
    [onStatusChange, router],
  );

  const view = placementRetryView(status, count, expiry);

  useEffect(() => {
    if (!view?.poll) return;
    const supabase = createClient();
    let active = true;

    const poll = async () => {
      const { data } = await supabase
        .from("matches")
        .select(
          "placement_status,placement_retry_count,placement_retry_expires_at",
        )
        .eq("id", matchId)
        .single();
      if (active && data) updateLifecycle(data as PlacementLifecycleRow);
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [matchId, updateLifecycle, view?.poll]);

  const requestRetry = async () => {
    if (!isOwner || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/placement-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      if (!response.ok) {
        if (body.code === "already_retrying") {
          updateLifecycle({
            placement_status: "retrying",
            placement_retry_count: 1,
            placement_retry_expires_at: expiry,
          });
          return;
        }
        if (body.code === "source_expired") {
          updateLifecycle({
            placement_status: "final_failed",
            placement_retry_count: count,
            placement_retry_expires_at: expiry,
          });
        }
        setError(
          RETRY_ERROR_COPY[body.code ?? ""]
            ?? "We couldn't start another placement attempt. Please try again.",
        );
        return;
      }

      updateLifecycle({
        placement_status: "retrying",
        placement_retry_count: 1,
        placement_retry_expires_at: expiry,
      });
    } catch {
      setError(
        "We couldn't start another placement attempt. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!view) return null;

  return (
    <section
      aria-label="Placement status"
      className={`mb-4 rounded-xl border p-4 ${toneClasses(view.tone)}`}
    >
      <div className="flex items-start gap-3">
        {view.tone === "progress" && (
          <span
            aria-hidden="true"
            className="mt-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-glow/30 border-t-cyan-glow"
          />
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">{view.title}</h3>
          <p className="mt-1 text-sm leading-6 text-zinc-400">{view.body}</p>
        </div>
      </div>

      {view.action && isOwner && (
        <button
          type="button"
          disabled={submitting}
          onClick={() => void requestRetry()}
          className="mt-4 rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
        >
          {submitting ? "Starting…" : view.action}
        </button>
      )}
      <p aria-live="polite" className="mt-2 text-sm text-red-300">
        {error}
      </p>
    </section>
  );
}
