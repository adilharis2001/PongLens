import Link from "next/link";
import type { LearnAudience } from "./catalogTypes";

export function LearnAudienceSwitch({
  audience,
  activeWorkspace,
  canSwitch,
}: {
  audience: LearnAudience;
  activeWorkspace: LearnAudience;
  canSwitch: boolean;
}) {
  if (!canSwitch) return null;

  const href = (value: LearnAudience) =>
    value === activeWorkspace ? "/learn" : `/learn?audience=${value}`;

  return (
    <nav aria-label="Learn audience" className="mt-4 flex w-fit rounded-full border border-edge p-1">
      {(["player", "coach"] as const).map((value) => {
        const selected = value === audience;
        return (
          <Link
            key={value}
            href={href(value)}
            aria-current={selected ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              selected
                ? "bg-surface-2 text-white"
                : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            {value === "player" ? "Playing" : "Coaching"}
          </Link>
        );
      })}
    </nav>
  );
}
