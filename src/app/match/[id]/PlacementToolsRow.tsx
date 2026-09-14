"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { BottomSheet, SHEET_PRIMARY_BUTTON } from "@/components/BottomSheet";
import {
  placementRequestUiTransition,
  type PlacementRequestUiState,
} from "@/lib/placement/placementRetry";
import { BetaPill } from "@/components/BetaPill";
import { TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";
import type { PlacementLifecycleController } from "./usePlacementLifecycle";

const INITIAL_REQUEST_UI_STATE: PlacementRequestUiState = {
  sheetOpen: false,
  acknowledgement: null,
  acknowledgementSequence: 0,
};

export function PlacementToolsRow({
  controller,
  onReady,
}: {
  controller: PlacementLifecycleController;
  onReady: () => void;
}) {
  const { clearError } = controller;
  const [requestUi, dispatchRequestUi] = useReducer(
    placementRequestUiTransition,
    INITIAL_REQUEST_UI_STATE,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedOnce = useRef(false);
  const acknowledgementId = requestUi.acknowledgement?.id;

  const close = useCallback(() => {
    dispatchRequestUi({ type: "close" });
    clearError();
  }, [clearError]);

  // The sheet handles Escape, scroll-lock and its own focus; the row only
  // remembers that it has opened, to hand focus back afterwards.
  useEffect(() => {
    if (requestUi.sheetOpen) openedOnce.current = true;
  }, [requestUi.sheetOpen]);

  useEffect(() => {
    if (!requestUi.sheetOpen && openedOnce.current) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [requestUi.sheetOpen]);

  useEffect(() => {
    if (acknowledgementId === undefined) return;
    const timer = window.setTimeout(
      () => dispatchRequestUi({ type: "dismiss_acknowledgement" }),
      5_000,
    );
    return () => window.clearTimeout(timer);
  }, [acknowledgementId]);

  return (
    <div>
      <button
        ref={triggerRef}
        id="placement-tools"
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          clearError();
          if (controller.status === "ready") onReady();
          else dispatchRequestUi({ type: "open" });
        }}
        className={TOOL_ROW_CLASS}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          Placement maps
          <BetaPill />
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {controller.view.poll && (
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-glow/30 border-t-cyan-glow"
            />
          )}
          <span aria-live="polite" className="text-xs text-zinc-500">
            {controller.view.toolStatus}
          </span>
          <ToolRowChevron />
        </span>
      </button>

      <BottomSheet
        open={requestUi.sheetOpen}
        portal
        title={controller.view.sheetTitle}
        subtitle={controller.view.sheetBody}
        onClose={close}
        closeLabel="Close placement maps sheet"
      >
        {controller.view.actionKind && (
          <button
            type="button"
            disabled={controller.submitting}
            onClick={() => {
              void controller.requestAction().then((accepted) => {
                dispatchRequestUi({
                  type: accepted ? "started" : "failed",
                });
              });
            }}
            className={`${SHEET_PRIMARY_BUTTON} mt-5 disabled:cursor-wait`}
          >
            {controller.submitting
              ? "Starting…"
              : controller.view.actionLabel}
          </button>
        )}
        <p
          aria-live="polite"
          className={`text-sm text-red-300 ${
            controller.error ? "mt-3" : ""
          }`}
        >
          {controller.error}
        </p>
      </BottomSheet>

      {requestUi.acknowledgement && (
        <div
          key={requestUi.acknowledgement.id}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-24 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-edge bg-surface px-4 py-3 text-sm text-zinc-100 shadow-2xl md:bottom-6"
        >
          {requestUi.acknowledgement.message}
        </div>
      )}
    </div>
  );
}
