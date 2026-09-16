import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import {
  STAGE_DOT,
  STAGE_LABEL,
  canVote,
  groupRoadmap,
  nextVote,
  scoreLabel,
  shippedLabel,
  type RoadmapItem,
  type RoadmapVote,
} from "@/lib/roadmap";

/**
 * The roadmap as a reader sees it: three sections, each hidden when
 * empty, each entry a title and one sentence. Shipped entries carry the
 * month; the others carry their score, and a vote box when the reader is
 * signed in and `onVote` is given. No hooks, so the public page can
 * render it on the server and the board's tab on the client from the
 * same file.
 */
export function RoadmapSections({
  items,
  votes = {},
  onVote,
}: {
  items: RoadmapItem[];
  /** The reader's own vote per entry id. */
  votes?: Record<string, RoadmapVote>;
  /** Present when the reader may vote; absent on the public page. */
  onVote?: (item: RoadmapItem, vote: RoadmapVote) => void;
}) {
  const groups = groupRoadmap(items);
  if (groups.length === 0) {
    return <p className="text-sm text-zinc-500">Nothing on the roadmap yet.</p>;
  }
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.stage}>
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[group.stage]}`}
              aria-hidden="true"
            />
            <SectionHeading>{STAGE_LABEL[group.stage]}</SectionHeading>
          </div>
          <ul className="mt-3 space-y-2.5">
            {group.items.map((item) => {
              const voting = canVote(item.stage);
              const when = group.stage === "shipped" ? shippedLabel(item.shipped_at) : null;
              const mine = votes[item.id] ?? 0;
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-xl border border-edge bg-surface px-4 py-3"
                >
                  {voting && onVote && (
                    <RoadmapVoteBox
                      score={item.score}
                      vote={mine}
                      onVote={(v) => onVote(item, v)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium text-zinc-100">{item.title}</p>
                      {when && (
                        <span className="shrink-0 text-[11px] text-zinc-500">{when}</span>
                      )}
                      {voting && !onVote && <RoadmapScorePill score={item.score} />}
                    </div>
                    {item.description && (
                      <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                        {item.description}
                      </p>
                    )}
                    {item.link && (
                      <Link
                        href={item.link}
                        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-cyan-glow transition-colors hover:text-white"
                      >
                        Try it
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
                        </svg>
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Arrow({ up, className }: { up: boolean; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={up ? "m6 14 6-6 6 6" : "m6 10 6 6 6-6"} />
    </svg>
  );
}

/**
 * Up, the score, down. The board's vote box with a second arrow: cyan
 * when you are for it, amber when you are against, grey when you have
 * not said. Pressing the lit arrow again takes the vote back.
 */
export function RoadmapVoteBox({
  score,
  vote,
  onVote,
}: {
  score: number;
  vote: RoadmapVote;
  onVote: (vote: RoadmapVote) => void;
}) {
  const tone =
    vote === 1 ? "text-cyan-glow" : vote === -1 ? "text-amber-300" : "text-zinc-300";
  const arrow = (up: boolean) => {
    const on = vote === (up ? 1 : -1);
    return (
      <button
        type="button"
        onClick={() => onVote(nextVote(vote, up ? 1 : -1))}
        aria-label={up ? (on ? "Remove your vote" : "Vote for this") : on ? "Remove your vote" : "Vote against this"}
        aria-pressed={on}
        className={`flex h-6 w-full items-center justify-center rounded-lg transition-colors ${
          on
            ? up
              ? "text-cyan-glow"
              : "text-amber-300"
            : "text-zinc-500 hover:bg-surface-2 hover:text-zinc-200"
        }`}
      >
        <Arrow up={up} className="h-4 w-4" />
      </button>
    );
  };
  return (
    <div
      className={`flex w-10 shrink-0 flex-col items-center rounded-xl border bg-surface-2/40 py-0.5 ${
        vote === 1
          ? "border-cyan-glow/50"
          : vote === -1
            ? "border-amber-400/50"
            : "border-edge"
      }`}
    >
      {arrow(true)}
      <span className={`text-xs font-semibold tabular-nums ${tone}`}>{scoreLabel(score)}</span>
      {arrow(false)}
    </div>
  );
}

/** The score alone, where nobody can vote: the public page, the admin list. */
export function RoadmapScorePill({ score }: { score: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-zinc-500"
      aria-label={`Score ${scoreLabel(score)}`}
    >
      <Arrow up className="h-3 w-3" />
      <span className="tabular-nums">{scoreLabel(score)}</span>
    </span>
  );
}
