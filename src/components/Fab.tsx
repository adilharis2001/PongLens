"use client";

import Link from "next/link";
import { confirmLeaveDuringUpload } from "@/lib/uploadGuard";

/**
 * The one create action each tab has: Upload on Home and Matches, New
 * entry on the Journal, New lesson on Coaching, New entry on a coach's
 * student page. Destinations live in the nav; the create action sits
 * with the content it acts on.
 *
 * Two forms, one component. On a phone it floats in the bottom corner,
 * clear of the fixed bottom bar, where the thumb is. On a desktop it is a
 * pill at the right end of the page title: the corner of a wide monitor is
 * far outside the content column and the floating button went unnoticed
 * there (Adil, 2026-09-24). Render `UploadAction` / `CreateAction` once,
 * inside a `TitleRow`; the floating form positions itself.
 */

const FLOAT_CLASS =
  "glow-cta fixed right-5 z-40 flex items-center gap-2 rounded-full " +
  "bg-cyan-glow px-5 py-3.5 text-sm font-semibold text-ink shadow-lg " +
  "shadow-black/40 bottom-[calc(5rem+env(safe-area-inset-bottom))]";

/** The floating form, phones only. The desktop header starts at md. */
const FAB_CLASS = `${FLOAT_CLASS} md:hidden`;

/** The title-row form, desktop only. */
const PILL_CLASS =
  "glow-cta hidden shrink-0 items-center gap-2 rounded-full bg-cyan-glow " +
  "px-5 py-2.5 text-sm font-semibold text-ink md:inline-flex";

function UploadGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4.5 w-4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4.5 w-4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * The page title with its create action at the far right. The title is
 * the only thing in the row on a phone, where the action floats instead.
 */
export function TitleRow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      {children}
    </div>
  );
}

/** Upload, in both forms. */
export function UploadAction() {
  const guard = (e: React.MouseEvent) => {
    if (!confirmLeaveDuringUpload()) e.preventDefault();
  };
  return (
    <>
      <Link href="/upload" onClick={guard} className={PILL_CLASS}>
        <UploadGlyph />
        Upload
      </Link>
      <Link href="/upload" onClick={guard} className={FAB_CLASS}>
        <UploadGlyph />
        Upload
      </Link>
    </>
  );
}

/** An action that opens a sheet or composer, in both forms. */
export function CreateAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <>
      <button type="button" onClick={onClick} className={PILL_CLASS}>
        <PlusGlyph />
        {label}
      </button>
      <button type="button" onClick={onClick} className={FAB_CLASS}>
        <PlusGlyph />
        {label}
      </button>
    </>
  );
}

/**
 * The floating form on its own, for a page that already has the action
 * in its desktop layout: Feedback keeps its composer in a side column
 * from lg up and floats this below that.
 */
export function FabButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={FLOAT_CLASS}>
      <PlusGlyph />
      {label}
    </button>
  );
}
