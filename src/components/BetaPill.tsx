/**
 * One word, next to the thing it qualifies.
 *
 * Placement maps come from computer vision, and the table calibration they
 * rest on is not always right. That is worth saying — but saying it in a
 * sentence, on every surface, would cost more attention than the feature
 * is worth. A pill sits beside the title, reads in a glance, and stops
 * being read once it's known.
 *
 * Amber because the app already uses amber for "heads up" (journal cue
 * notices), and because cyan is the accent — a beta marker should not look
 * like a feature being advertised.
 */
export function BetaPill({ className }: { className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border border-amber-400/25 bg-amber-400/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-200/90 ${className ?? ""}`}
    >
      Beta
    </span>
  );
}
