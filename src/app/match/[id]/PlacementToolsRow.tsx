"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";
import type { PlacementLifecycleController } from "./usePlacementLifecycle";

export function PlacementToolsRow({
  controller,
  onReady,
}: {
  controller: PlacementLifecycleController;
  onReady: () => void;
}) {
  const { clearError } = controller;
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openedOnce = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (!open) return;

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
  }, [close, open]);

  useEffect(() => {
    if (!open && openedOnce.current) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

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
          else setOpen(true);
        }}
        className={TOOL_ROW_CLASS}
      >
        <span className="text-sm font-semibold">Placement maps</span>
        <span className="flex shrink-0 items-center gap-2">
          <span aria-live="polite" className="text-xs text-zinc-500">
            {controller.view.toolStatus}
          </span>
          <ToolRowChevron />
        </span>
      </button>

      {open
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4"
            >
              <button
                type="button"
                aria-label="Close placement maps sheet"
                onClick={close}
                className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
              />
              <div className="relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-edge bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:max-w-sm sm:rounded-2xl sm:pb-5 sm:pt-5">
                <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-edge sm:hidden" />
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    {controller.view.poll && (
                      <span
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-glow/30 border-t-cyan-glow"
                      />
                    )}
                    <div className="min-w-0">
                      <h2
                        id={titleId}
                        className="text-base font-semibold text-zinc-100"
                      >
                        {controller.view.sheetTitle}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-zinc-400">
                        {controller.view.sheetBody}
                      </p>
                    </div>
                  </div>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={close}
                    aria-label="Close"
                    className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-surface-2 hover:text-white"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 6l12 12M18 6L6 18"
                      />
                    </svg>
                  </button>
                </div>

                {controller.view.actionKind && (
                  <button
                    type="button"
                    disabled={controller.submitting}
                    onClick={() => void controller.requestAction()}
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
    </div>
  );
}
