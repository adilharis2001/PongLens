"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * The app's one writing surface, shared by notes, offerings, and review
 * write-ups. A plain textarea on purpose: autocorrect, dictation, IME,
 * native undo and accessibility come free, and the "feel" lives in sizing
 * and typography, not the editing substrate.
 *
 * Growth is CSS-first (`field-sizing: content` — Chrome 123+, Safari
 * 26.2+, Firefox 152+) with a scrollHeight fallback for the stragglers;
 * the fallback is scaffolding to delete once iOS 26.2 is everywhere.
 *
 * Two shapes:
 *   document (default) — the field IS the content: grows forever, never
 *                        scrolls inside itself. The page scrolls.
 *   composer           — the field sits above other content that must
 *                        stay visible: grows to min(40dvh, 20rem), then
 *                        scrolls internally.
 *
 * Mobile behavior is baked in: 16px font on touch via the global input
 * override (kills the iOS focus zoom), platform autocapitalize and
 * autocorrect left alone (prose wants them), Enter always inserts a
 * newline, cyan caret so it survives the dark surface.
 */

const SUPPORTS_FIELD_SIZING =
  typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");

export function AutoTextarea({
  variant = "document",
  className = "",
  value,
  ref: refProp,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  variant?: "composer" | "document";
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = (el: HTMLTextAreaElement | null) => {
    ref.current = el;
    if (typeof refProp === "function") refProp(el);
    else if (refProp) refProp.current = el;
  };

  // Fallback auto-grow only where field-sizing is missing.
  useLayoutEffect(() => {
    if (SUPPORTS_FIELD_SIZING) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const cap =
      variant === "composer"
        ? Math.min(window.innerHeight * 0.4, 320)
        : Infinity;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    el.style.overflowY = el.scrollHeight > cap ? "auto" : "hidden";
  }, [value, variant]);

  const shape =
    variant === "composer"
      ? "max-h-[min(40dvh,20rem)] overflow-y-auto overscroll-contain"
      : "overflow-y-hidden";

  return (
    <textarea
      ref={setRefs}
      value={value}
      wrap="soft"
      className={
        "block w-full resize-none leading-relaxed caret-cyan-glow " +
        "[field-sizing:content] [scroll-margin-block:1.5rem] " +
        "placeholder:text-zinc-600 " +
        `${shape} ${className}`
      }
      {...rest}
    />
  );
}
