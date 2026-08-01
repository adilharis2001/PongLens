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
  wrap = false,
}: {
  score: MatchScore;
  className?: string;
  /** Wrap onto a second line instead of scrolling within one. Only for
   *  places that own their full width (the floating bar's expanded row):
   *  a scroll nobody can see is a scroll nobody uses, so where there's
   *  room to wrap, every game stays on screen with no gesture at all. */
  wrap?: boolean;
}) {
  const segs: { you: number; them: number }[] = [...score.games];
  if (score.current.you + score.current.them > 0 || segs.length === 0) {
    segs.push(score.current);
  }
  if (wrap) {
    // Flex, not inline text: the segments carry no whitespace between them
    // (see below), so inline layout has nowhere to break and would overflow
    // instead of wrapping. Flex items always give a break opportunity.
    //
    // The gap does the separating, so no middot is left dangling at the end
    // of a wrapped line — which means the gap has to be visibly wider than
    // the hyphen inside a game, or "11-3 7-12" reads as one long number.
    return (
      <p className={`flex flex-wrap gap-x-3 gap-y-1 ${className ?? ""}`}>
        {segs.map((g, i) => (
          <span key={i} className="whitespace-nowrap">
            <span className="text-cyan-glow">{g.you}</span>
            <span className="text-zinc-600">-</span>
            <span className="text-magenta-soft">{g.them}</span>
          </span>
        ))}
      </p>
    );
  }
  return (
    // A long match must never widen the page. The segments carry no
    // whitespace between them, so this line has NO break opportunity and
    // will happily push its container past the viewport — which on the
    // fixed score pill turned into horizontal scroll on the whole document.
    //
    // So it scrolls within whatever width it is given instead of forcing
    // one. dir=rtl parks that scroll at the END, because the game you are
    // playing matters more than the one you finished an hour ago; the inner
    // span restores ltr so the scores themselves read normally.
    <p
      dir="rtl"
      className={`block max-w-full overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className ?? ""}`}
    >
      <span dir="ltr">
        {segs.map((g, i) => (
          <span key={i} className="whitespace-nowrap">
            {i > 0 && <span className="mx-1 text-zinc-600">·</span>}
            <span className="text-cyan-glow">{g.you}</span>
            <span className="text-zinc-600">-</span>
            <span className="text-magenta-soft">{g.them}</span>
          </span>
        ))}
      </span>
    </p>
  );
}
