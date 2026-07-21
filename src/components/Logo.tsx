import Link from "next/link";

/** Lens-ring glyph + wordmark: a cyan lens with a glass glint, no center dot. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="group flex items-center gap-2.5">
      <span className="relative flex h-8 w-8 items-center justify-center">
        <svg
          viewBox="0 0 32 32"
          className="h-8 w-8"
          aria-hidden="true"
          fill="none"
        >
          {/* lens ring */}
          <circle
            cx="16"
            cy="16"
            r="12"
            stroke="#22d3ee"
            strokeWidth="2.5"
            opacity="0.95"
          />
          {/* glass glint — partial inner arc, upper-left to top */}
          <path
            d="M8.86 11.88 A8.25 8.25 0 0 1 18.14 8.03"
            stroke="#22d3ee"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.5"
          />
        </svg>
        <span className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100 glow-ring" />
      </span>
      <span className="text-lg font-semibold tracking-tight text-white">
        Pong<span className="text-cyan-glow">Lens</span>
      </span>
    </Link>
  );
}
