"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isPlacementTerminal,
  isPlacementRequestCurrent,
  placementActionEndpoint,
  placementExpiryTimerDelay,
  placementLifecycleView,
  placementRequestFailureResolution,
  placementRequestErrorCopy,
  type PlacementLifecycleView,
  type PlacementRequestIdentity,
} from "@/lib/placement/placementRetry";
import { createClient } from "@/lib/supabase/client";
import type { MatchPlacementStatus } from "@/lib/types";

interface PlacementLifecycleRow {
  placement_status: MatchPlacementStatus;
  placement_retry_count: 0 | 1;
  placement_retry_expires_at: string | null;
  placement_failure_code: string | null;
}

export interface PlacementLifecycleController {
  status: MatchPlacementStatus;
  retryCount: 0 | 1;
  expiresAt: string | null;
  failureCode: string | null;
  view: PlacementLifecycleView;
  submitting: boolean;
  error: string | null;
  requestAction: () => Promise<boolean>;
  clearError: () => void;
}

export function usePlacementLifecycle({
  matchId,
  initialStatus,
  initialRetryCount,
  initialExpiresAt,
  initialFailureCode,
}: {
  matchId: string;
  initialStatus: MatchPlacementStatus;
  initialRetryCount: 0 | 1;
  initialExpiresAt: string | null;
  initialFailureCode: string | null;
}): PlacementLifecycleController {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [retryCount, setRetryCount] = useState(initialRetryCount);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [failureCode, setFailureCode] = useState(initialFailureCode);
  const [viewNow, setViewNow] = useState(() => new Date());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestEpoch = useRef(0);
  const currentMatchId = useRef(matchId);
  const refreshedTerminal = useRef<MatchPlacementStatus | null>(
    isPlacementTerminal(initialStatus) ? initialStatus : null,
  );

  useEffect(() => {
    currentMatchId.current = matchId;
    requestEpoch.current += 1;
    setStatus(initialStatus);
    setRetryCount(initialRetryCount);
    setExpiresAt(initialExpiresAt);
    setFailureCode(initialFailureCode);
    setViewNow(new Date());
    setSubmitting(false);
    setError(null);
    refreshedTerminal.current = isPlacementTerminal(initialStatus)
      ? initialStatus
      : null;
  }, [
    matchId,
    initialStatus,
    initialRetryCount,
    initialExpiresAt,
    initialFailureCode,
  ]);

  const view = placementLifecycleView(
    status,
    retryCount,
    expiresAt,
    viewNow,
    failureCode,
  );

  const updateLifecycle = useCallback(
    (row: PlacementLifecycleRow) => {
      setStatus(row.placement_status);
      setRetryCount(row.placement_retry_count);
      setExpiresAt(row.placement_retry_expires_at);
      setFailureCode(row.placement_failure_code);

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

  const loadLifecycle = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("matches")
      .select(
        "placement_status,placement_retry_count,placement_retry_expires_at,placement_failure_code",
      )
      .eq("id", matchId)
      .single();
    return data ? data as PlacementLifecycleRow : null;
  }, [matchId]);

  useEffect(() => {
    const delay = placementExpiryTimerDelay(expiresAt);
    if (delay === null) return;
    const timer = window.setTimeout(() => setViewNow(new Date()), delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt, viewNow]);

  useEffect(() => {
    if (!view.poll) return;

    let active = true;
    const poll = async () => {
      const row = await loadLifecycle();
      if (active && row) updateLifecycle(row);
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadLifecycle, updateLifecycle, view.poll]);

  const requestAction = useCallback(async () => {
    const action = view.actionKind;
    if (!action || submitting) return false;

    const request: PlacementRequestIdentity = {
      matchId,
      epoch: requestEpoch.current + 1,
    };
    requestEpoch.current = request.epoch;
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
      const current = {
        matchId: currentMatchId.current,
        epoch: requestEpoch.current,
      };
      if (!isPlacementRequestCurrent(request, current)) return false;
      if (response.status !== 202) {
        const resolution = placementRequestFailureResolution(
          action,
          body.code,
        );
        if (resolution.status) {
          setStatus(resolution.status);
          setFailureCode(null);
        }
        if (resolution.retryCount) setRetryCount(resolution.retryCount);
        if (resolution.expireSource) {
          setExpiresAt(null);
          setFailureCode("source_expired");
        }
        let reconciled = false;
        if (resolution.reconcileLifecycle) {
          const row = await loadLifecycle();
          const afterLoad = {
            matchId: currentMatchId.current,
            epoch: requestEpoch.current,
          };
          if (!isPlacementRequestCurrent(request, afterLoad)) return false;
          if (row) {
            updateLifecycle(row);
            reconciled = true;
          } else {
            router.refresh();
          }
        }
        setError(
          resolution.showError && !reconciled
            ? placementRequestErrorCopy(body.code)
            : null,
        );
        return false;
      }

      refreshedTerminal.current = null;
      setStatus(action === "generate" ? "processing" : "retrying");
      if (action === "retry") setRetryCount(1);
      setFailureCode(null);
      return true;
    } catch {
      const current = {
        matchId: currentMatchId.current,
        epoch: requestEpoch.current,
      };
      if (isPlacementRequestCurrent(request, current)) {
        setError(placementRequestErrorCopy());
      }
      return false;
    } finally {
      const current = {
        matchId: currentMatchId.current,
        epoch: requestEpoch.current,
      };
      if (isPlacementRequestCurrent(request, current)) {
        setSubmitting(false);
      }
    }
  }, [
    loadLifecycle,
    matchId,
    router,
    submitting,
    updateLifecycle,
    view.actionKind,
  ]);

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    retryCount,
    expiresAt,
    failureCode,
    view,
    submitting,
    error,
    requestAction,
    clearError,
  };
}
