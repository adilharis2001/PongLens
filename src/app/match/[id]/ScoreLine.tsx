import type { MatchScore } from "./gameScore";

/**
 * The one pair of numbers that stands for a whole match.
 *
 * Games won, which is how a finished match is read out loud ("he took it
 * 6-1") and — unlike the per-game line — is always two short numbers, so it
 * fits anywhere without being cut off. Before the first game is WON there
 * are no games to count, so the game being played IS the score; reading
 * "0-0" over a live 7-5 would just be wrong.
 *
 * Won, not merely closed: a game you pinned the end of but have barely
 * scored belongs to nobody yet (gameWinner), so it can't put a 1 on this
 * line and can't push the live game off it either.
 */
export function matchHeadline(score: MatchScore): {
  you: number;
  them: number;
  label: string;
} {
  if (score.gamesYou + score.gamesThem > 0) {
    return {
      you: score.gamesYou,
      them: score.gamesThem,
      label: `Games: ${score.gamesYou} to ${score.gamesThem}`,
    };
  }
  return {
    you: score.current.you,
    them: score.current.them,
    label: `Current game: ${score.current.you} to ${score.current.them}`,
  };
}

/** The headline pair on its own, for rows that already have an action of
 *  their own and so can't nest a button (the Tools "Keep score" row). */
export function GamesPair({
  score,
  className,
}: {
  score: MatchScore;
  className?: string;
}) {
  const head = matchHeadline(score);
  return (
    <span className={`shrink-0 tabular-nums ${className ?? ""}`}>
      <span className="text-cyan-glow">{head.you}</span>
      <span className="mx-0.5 text-zinc-600">-</span>
      <span className="text-magenta-soft">{head.them}</span>
    </span>
  );
}

/** The headline pair as a disclosure button: the chevron is what says the
 *  per-game detail exists, which a hidden horizontal scrollbar never did. */
export function GamesToggle({
  score,
  open,
  onToggle,
  className,
}: {
  score: MatchScore;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const head = matchHeadline(score);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${head.label}. Tap for the score of each game`}
      className="flex shrink-0 items-center gap-1 text-zinc-300 transition-colors hover:text-white"
    >
      <GamesPair score={score} className={className} />
      <svg
        viewBox="0 0 24 24"
        className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${
          open ? "rotate-180" : ""
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

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
