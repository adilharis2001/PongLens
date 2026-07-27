"use client";

import Link from "next/link";
import { confirmLeaveDuringUpload } from "@/lib/uploadGuard";

/**
 * Floating primary action, one per tab: Home and Matches float "Upload",
 * Improve floats "New note". Destinations live in the nav; the create
 * action floats above the content it acts on — same pattern on every
 * breakpoint. On mobile it clears the fixed bottom bar.
 */

const FAB_CLASS =
  "glow-cta fixed right-5 z-40 flex items-center gap-2 rounded-full " +
  "bg-cyan-glow px-5 py-3.5 text-sm font-semibold text-ink shadow-lg " +
  "shadow-black/40 bottom-[calc(5rem+env(safe-area-inset-bottom))] " +
  "md:bottom-8 md:right-8";

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

export function UploadFab() {
  return (
    <Link
      href="/upload"
      onClick={(e) => {
        if (!confirmLeaveDuringUpload()) e.preventDefault();
      }}
      className={FAB_CLASS}
    >
      <UploadGlyph />
      Upload
    </Link>
  );
}

/** Button variant for actions that open a sheet (Improve's "New note"). */
export function FabButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={FAB_CLASS}>
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
      {label}
    </button>
  );
}
