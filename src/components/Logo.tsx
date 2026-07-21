import Link from "next/link";

/** Aperture-ring glyph + wordmark. */
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
          {/* outer aperture ring */}
          <circle
            cx="16"
            cy="16"
            r="13.5"
            stroke="#22d3ee"
            strokeWidth="2"
            opacity="0.9"
          />
          {/* aperture blades */}
          <g stroke="#22d3ee" strokeWidth="1.6" strokeLinecap="round">
            <path d="M16 2.5 L16 10" opacity="0.55" />
            <path d="M27.7 9.25 L21.2 13" opacity="0.55" />
            <path d="M27.7 22.75 L21.2 19" opacity="0.55" />
            <path d="M16 29.5 L16 22" opacity="0.55" />
            <path d="M4.3 22.75 L10.8 19" opacity="0.55" />
            <path d="M4.3 9.25 L10.8 13" opacity="0.55" />
          </g>
          {/* the ball at the center of the lens */}
          <circle cx="16" cy="16" r="3.5" fill="#e879f9" />
        </svg>
        <span className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100 glow-ring" />
      </span>
      <span className="text-lg font-semibold tracking-tight text-white">
        Pong<span className="text-cyan-glow">Lens</span>
      </span>
    </Link>
  );
}
