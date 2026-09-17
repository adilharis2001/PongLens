import { BETA_ALLOWANCE } from "@/lib/marketing/beta";

/**
 * What it costs, on both landing pages.
 *
 * A contained card in the flow of the page, deliberately not a band: the
 * first version of this was a full-width strip and it read as a second
 * call to action sitting on top of the real one. Here the heading is the
 * question a visitor has, the card answers it in one line, and the three
 * figures are the facts behind that line. The hero and the close keep
 * their single sentence; the numbers live here and in the FAQ.
 */
export function BetaAllowance({
  audience,
}: {
  audience: "players" | "coaches";
}) {
  const { processingMinutes, storageGb, matchesWord } = BETA_ALLOWANCE;
  const coaches = audience === "coaches";

  const facts = coaches
    ? [
        {
          value: "$0",
          label: "during beta",
          note: "Students, lesson notes and match feedback. No card to enter.",
        },
        {
          value: String(processingMinutes),
          label: "processing minutes",
          note: "The same allowance as every account, for lesson videos and recaps.",
        },
        {
          value: `${storageGb} GB`,
          label: "of storage",
          note: "Lesson recordings, videos and recaps.",
        },
      ]
    : [
        {
          value: String(processingMinutes),
          label: "processing minutes",
          note: `A match uses its recording length, so this covers about ${matchesWord} matches.`,
        },
        {
          value: `${storageGb} GB`,
          label: "of storage",
          note: "Your originals, cut videos and every point clip.",
        },
        {
          value: "$0",
          label: "to start",
          note: "No card to enter. When you run out, request more and it is added for free.",
        },
      ];

  return (
    <section id="cost" className="scroll-mt-20 py-14 sm:py-20">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          What it costs
        </h2>
        <div className="mt-10 rounded-2xl border border-edge bg-surface/40 p-6 sm:p-8">
          <p className="text-lg leading-relaxed text-zinc-200">
            {coaches
              ? "Nothing during beta. The coaching side is free, and anything you process draws on the same free allowance every account has."
              : `Nothing during beta. Every account comes with enough to analyze ${matchesWord} matches, and more is free on request.`}
          </p>
          <dl className="mt-8 grid gap-6 sm:grid-cols-3 sm:gap-8">
            {facts.map((f) => (
              <div key={f.label} className="flex flex-col">
                <dt className="text-sm text-zinc-400">{f.label}</dt>
                <dd className="order-first text-3xl font-semibold tracking-tight text-white">
                  {f.value}
                </dd>
                <dd className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {f.note}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 border-t border-edge pt-5 text-sm leading-relaxed text-zinc-400">
            {coaches
              ? "A platform fee comes off each paid match review. The offering editor shows what you will receive before you publish a price."
              : "Your originals, cut videos and clips stay in your library until you delete the match, during beta and after it."}
          </p>
        </div>
      </div>
    </section>
  );
}
