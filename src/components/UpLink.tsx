import Link from "next/link";

/**
 * The app's one "up" control, extracted from the match page (see the
 * rationale there): up, not back — it names where it climbs and behaves
 * the same however you arrived, while the browser's own Back still walks
 * history. A pill, because everything else you can press near a page top
 * is one; bare "←" text links read like leftovers and drifted
 * inconsistent across the review surfaces.
 */
export function UpLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 rounded-full border border-edge bg-surface/70 py-1.5 pl-1.5 pr-4 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-zinc-400 transition-colors group-hover:text-cyan-glow">
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
        </svg>
      </span>
      {label}
    </Link>
  );
}
