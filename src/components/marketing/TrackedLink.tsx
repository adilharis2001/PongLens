"use client";

import Link from "next/link";
import { track } from "@vercel/analytics";
import type { ComponentProps } from "react";

/**
 * A link that records which call to action was pressed, and where on the
 * page it sat. Vercel Analytics is cookieless, so this adds nothing a
 * visitor has to consent to; it only lets the landing page answer which
 * section leads to sign-ups, which page views alone cannot.
 */
export function TrackedLink({
  event,
  section,
  onClick,
  ...props
}: ComponentProps<typeof Link> & { event: string; section: string }) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        try {
          track(event, { section });
        } catch {
          // Analytics must never stand between a person and the link.
        }
        onClick?.(e);
      }}
    />
  );
}
