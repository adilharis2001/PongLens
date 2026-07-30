"use client";

import { useCallback, useEffect, useId, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import {
  placementRequestUiTransition,
  type PlacementRequestUiState,
} from "@/lib/placement/placementRetry";
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
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openedOnce = useRef(false);
  const acknowledgementId = requestUi.acknowledgement?.id;

  const close = useCallback(() => {
    dispatchRequestUi({ type: "close" });
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (!requestUi.sheetOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    openedOnce.current = true;
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [close, requestUi.sheetOpen]);

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
        <span className="text-sm font-semibold">Placement maps</span>
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

      {requestUi.sheetOpen
        ? createPortal(
            <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
              <button
                type="button"
                aria-label="Close placement maps sheet"
                onClick={close}
                className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
              />
              <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-8 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 id={titleId} className="text-base font-semibold">
                      {controller.view.sheetTitle}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-400">
                      {controller.view.sheetBody}
                    </p>
                  </div>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={close}
                    aria-label="Close"
                    className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        d="M6 6l12 12M18 6L6 18"
                      />
                    </svg>
                  </button>
                </div>

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
                    className="glow-cta mt-5 w-full rounded-full bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
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
              </div>
            </div>,
            document.body,
          )
        : null}

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
