import type { MatchScore } from "./gameScore";

/**
 * The full match line, always: completed games joined with middots plus
 * the live current game — "11-6 · 11-5 · 3-1". Shown in the match header,
 * the floating pill, and the point-view headers (which feed it a score
 * computed over the points up to the one on screen, so it reads as the
 * running score at that moment).
 */
export function ScoreLine({
  score,
  className,
}: {
  score: MatchScore;
  className?: string;
}) {
  const segs: { you: number; them: number }[] = [...score.games];
  if (score.current.you + score.current.them > 0 || segs.length === 0) {
    segs.push(score.current);
  }
  return (
    <p className={className}>
      {segs.map((g, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 && <span className="mx-1 text-zinc-600">·</span>}
          <span className="text-cyan-glow">{g.you}</span>
          <span className="text-zinc-600">-</span>
          <span className="text-magenta-soft">{g.them}</span>
        </span>
      ))}
    </p>
  );
}
