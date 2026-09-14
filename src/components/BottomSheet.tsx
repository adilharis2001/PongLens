"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The one dress a sheet wears: a dimmed, blurred backdrop; a panel that
 * rises from the bottom of a phone and sits centred from `sm` up; the
 * title top-left with a round close button opposite, and an optional line
 * under the title. The iOS app's `PLSheetScaffold`, for the web.
 *
 * Eight sheets off the match page used to carry their own copy of this
 * markup, and the copies had drifted: one had no blur, one closed with a
 * "Done" pill, two put the subtitle beside the close button and the rest
 * under the header (2026-09-14). One component, so a sheet cannot drift
 * on its own.
 *
 * Escape closes. The page behind stops scrolling while the sheet is up.
 * Focus lands on the close button when it opens, so a keyboard has
 * somewhere to be; a caller that wants its trigger focused again
 * afterwards does that itself, because only it knows the trigger.
 */
export function BottomSheet({
  open,
  title,
  subtitle,
  onClose,
  closeLabel = "Close",
  leading,
  portal = false,
  inline = false,
  widthClass = "sm:max-w-sm",
  autoFocusClose = true,
  children,
}: {
  open: boolean;
  title: string;
  /** One line under the title, when the title alone does not say enough. */
  subtitle?: ReactNode;
  onClose: () => void;
  /** The backdrop's accessible name, for the sheet that wants a specific one. */
  closeLabel?: string;
  /** Something before the title — a back arrow on a sheet with two steps. */
  leading?: ReactNode;
  /**
   * Render on <body>. For a sheet raised from inside a surface that
   * animates with a CSS transform (a transformed ancestor turns
   * position:fixed into position:absolute and the sheet gets swallowed
   * into that surface's scroll).
   */
  portal?: boolean;
  /**
   * Render in place, as a layer of the caller's own. For a caller that is
   * ALREADY a full-screen layer above <body>'s stack, where a portal would
   * land underneath it.
   */
  inline?: boolean;
  /** How wide the centred card may grow from `sm` up. */
  widthClass?: string;
  /** Off for a sheet that wants the keyboard in its own field on open. */
  autoFocusClose?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    if (!inline) document.body.style.overflow = "hidden";
    if (autoFocusClose) closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      if (!inline) document.body.style.overflow = previous;
    };
  }, [autoFocusClose, inline, onClose, open]);

  if (!open) return null;

  const node = (
    <div
      className={inline ? "absolute inset-0 z-20" : "fixed inset-0 z-[70]"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={id}
    >
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/70 backdrop-blur-sm"
      />
      <div
        className={`absolute inset-x-0 bottom-0 max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-t-2xl border border-edge bg-surface p-5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-3rem)] sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5 ${widthClass}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-2">
            {leading}
            <div className="min-w-0">
              <h2 id={id} className="text-base font-semibold">
                {title}
              </h2>
              {subtitle && (
                <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );

  return portal && typeof document !== "undefined"
    ? createPortal(node, document.body)
    : node;
}

/**
 * The sheet's one primary action: the full width of the sheet, cyan,
 * glowing, at least 44px tall. A sheet has at most one of these. Add
 * the top margin at the call site, where the thing above it is known.
 */
export const SHEET_PRIMARY_BUTTON =
  "glow-cta block min-h-11 w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-60";
