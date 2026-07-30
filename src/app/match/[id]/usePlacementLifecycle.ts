"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isPlacementTerminal,
  placementActionEndpoint,
  placementLifecycleView,
  placementRequestErrorCopy,
  type PlacementLifecycleView,
} from "@/lib/placement/placementRetry";
import { createClient } from "@/lib/supabase/client";
import type { MatchPlacementStatus } from "@/lib/types";

interface PlacementLifecycleRow {
  placement_status: MatchPlacementStatus;
  placement_retry_count: 0 | 1;
  placement_retry_expires_at: string | null;
}

export interface PlacementLifecycleController {
  status: MatchPlacementStatus;
  retryCount: 0 | 1;
  expiresAt: string | null;
  view: PlacementLifecycleView;
  submitting: boolean;
  error: string | null;
  requestAction: () => Promise<void>;
  clearError: () => void;
}

export function usePlacementLifecycle({
  matchId,
  initialStatus,
  initialRetryCount,
  initialExpiresAt,
}: {
  matchId: string;
  initialStatus: MatchPlacementStatus;
  initialRetryCount: 0 | 1;
  initialExpiresAt: string | null;
}): PlacementLifecycleController {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [retryCount, setRetryCount] = useState(initialRetryCount);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshedTerminal = useRef<MatchPlacementStatus | null>(
    isPlacementTerminal(initialStatus) ? initialStatus : null,
  );

  useEffect(() => {
    setStatus(initialStatus);
    setRetryCount(initialRetryCount);
    setExpiresAt(initialExpiresAt);
    refreshedTerminal.current = isPlacementTerminal(initialStatus)
      ? initialStatus
      : null;
  }, [matchId, initialStatus, initialRetryCount, initialExpiresAt]);

  const view = placementLifecycleView(status, retryCount, expiresAt);

  const updateLifecycle = useCallback(
    (row: PlacementLifecycleRow) => {
      setStatus(row.placement_status);
      setRetryCount(row.placement_retry_count);
      setExpiresAt(row.placement_retry_expires_at);

      if (isPlacementTerminal(row.placement_status)) {
        if (refreshedTerminal.current !== row.placement_status) {
          refreshedTerminal.current = row.placement_status;
          router.refresh();
        }
      } else {
        refreshedTerminal.current = null;
      }
    },
    [router],
  );

  useEffect(() => {
    if (!view.poll) return;

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
  }, [matchId, updateLifecycle, view.poll]);

  const requestAction = useCallback(async () => {
    const action = view.actionKind;
    if (!action || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(placementActionEndpoint(action), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      if (response.status !== 202) {
        setError(placementRequestErrorCopy(body.code));
        return;
      }

      refreshedTerminal.current = null;
      setStatus(action === "generate" ? "processing" : "retrying");
      if (action === "retry") setRetryCount(1);
    } catch {
      setError(placementRequestErrorCopy());
    } finally {
      setSubmitting(false);
    }
  }, [matchId, submitting, view.actionKind]);

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    retryCount,
    expiresAt,
    view,
    submitting,
    error,
    requestAction,
    clearError,
  };
}
