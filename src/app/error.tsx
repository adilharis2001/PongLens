"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console and any error monitoring you wire up.
    console.error(error);
  }, [error]);

  return (
    <main className="bg-arena flex flex-1 items-center justify-center px-6 py-24">
      <div className="mx-auto max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-magenta-soft">
          Something broke
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
          That didn&apos;t go as planned
        </h1>
        <p className="mt-4 leading-relaxed text-zinc-400">
          An unexpected error occurred. You can try again, or head back home.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <button
            onClick={reset}
            className="glow-cta rounded-full bg-cyan-glow px-8 py-3 text-base font-semibold text-ink"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-full px-5 py-3 text-base font-medium text-zinc-300 transition-colors hover:text-white"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
