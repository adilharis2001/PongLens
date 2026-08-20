"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * One confirmation dialog for destructive actions, in the same dress as
 * the match-delete confirm in MatchView/MatchLibrary: dimmed backdrop,
 * small centred card (bottom-anchored on phones), Cancel beside a red
 * confirm. It replaced the old tap-again-to-confirm links, which read as
 * a bug to anyone who had not met them before.
 *
 * Escape and the backdrop cancel. Focus lands on Cancel when it opens,
 * Tab stays inside, and focus returns to wherever it came from on close.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy = false,
  error = null,
  confirmDisabled = false,
  children,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  /** Optional single line under the title. Most deletes need none. */
  body?: string;
  confirmLabel: string;
  /** Disables both buttons and relabels the confirm while work runs. */
  busy?: boolean;
  /** A failed attempt shows here; the dialog stays up for a retry. */
  error?: string | null;
  /** Hold the confirm shut until the caller says it may fire. */
  confirmDisabled?: boolean;
  /** Anything the confirmation needs beyond a sentence — a field to type
   *  into, a list of what goes. Sits under the body, above any error. */
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelRef.current?.focus();
    return () => {
      const el = returnFocusRef.current;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = cardRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled])"
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center"
    >
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        disabled={busy}
        className="absolute inset-0 cursor-default bg-black/60"
      />
      <div
        ref={cardRef}
        className="relative w-full max-w-sm rounded-2xl border border-edge bg-surface p-6"
      >
        <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
        {body && (
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">{body}</p>
        )}
        {children && <div className="mt-4">{children}</div>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className="flex-1 rounded-full bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:opacity-50"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
