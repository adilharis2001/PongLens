"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ask, living inside the journal's search box rather than beside it.
 *
 * The search field keeps filtering as you type, instantly and for free.
 * This adds one row above the results offering to ask the same words as a
 * question. The model runs on a tap and never on a keystroke, which is
 * both the cost control and the reason the box stays predictable: typing
 * always filters, asking is always something you chose.
 *
 * The answer opens above the filtered list without disturbing it, so
 * asking never destroys what searching already found.
 */

interface AnswerPart {
  text: string;
  sourceIds: string[];
}

interface AskSource {
  id: string;
  kind: "note" | "lesson" | "practice" | "match" | "working_on" | "tags";
  title: string;
  href: string;
  when: string;
}

interface AskResponse {
  answer?: AnswerPart[];
  refused?: string | null;
  sources?: AskSource[];
  coverage?: string;
  code?: string;
}

/** Long enough to be a question rather than a stray word. */
const MIN_ASK_CHARS = 8;
export const MAX_QUESTION_CHARS = 400;

/**
 * Three questions worth tapping, built from this journal's own contents.
 *
 * Generic examples ("ask me anything about your notes") teach nothing —
 * they read as marketing. A question with the player's actual coach and
 * actual opponent in it is instantly legible as a real thing this box can
 * do, and it is one tap to prove it.
 */
export function askExamples(opts: {
  coachName?: string | null;
  opponentName?: string | null;
}): string[] {
  const out: string[] = [];
  if (opts.coachName) {
    out.push(`What has ${opts.coachName} told me to work on?`);
  }
  if (opts.opponentName) {
    out.push(`How do I do against ${opts.opponentName}?`);
  }
  out.push("What keeps costing me points?");
  if (out.length < 3) out.push("What should I work on next?");
  return out.slice(0, 3);
}

export function askable(query: string): boolean {
  const q = query.trim();
  return q.length >= MIN_ASK_CHARS && q.length <= MAX_QUESTION_CHARS &&
    q.includes(" ");
}

const KIND_LABEL: Record<AskSource["kind"], string> = {
  note: "Note",
  lesson: "Lesson",
  practice: "Practice",
  match: "Match",
  working_on: "Working on",
  tags: "Tags",
};

/** One sentence per failure, in the player's terms rather than the code's. */
function errorFor(code: string | undefined): string {
  switch (code) {
    case "too_fast":
      return "Give it a moment, then ask again.";
    case "daily_limit":
      return "That is all your questions for today. There will be more tomorrow.";
    case "token_budget":
      // Hit by size rather than by count: a very large journal spends the
      // day's allowance in fewer questions. Says the same thing as the
      // count limit, because to the player it is the same thing.
      return "That is all your questions for today. There will be more tomorrow.";
    case "busy":
      return "Ask is busy right now. Try again in a few minutes.";
    case "disabled":
      return "Ask is turned off at the moment.";
    case "question_too_long":
      return "That question is too long. Try it shorter.";
    case "no_answer":
      return "That did not come back cleanly. Try asking it another way.";
    default:
      return "Something went wrong. Try again.";
  }
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function AskPanel({
  query,
  examples = [],
  onReady,
}: {
  query: string;
  /** Tappable starter questions, shown only while the box is empty. */
  examples?: string[];
  /** Hands the parent a way to fire the same ask from the search field's
   *  Enter key, so there is still exactly one code path that spends a
   *  request. */
  onReady?: (ask: (question?: string) => void) => void;
}) {
  const [asked, setAsked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);
  // Guards a double tap racing itself into two paid requests.
  const inFlight = useRef(false);

  // An override lets an example question fire directly, without a round
  // trip through the parent's state. Tapping one is still a deliberate
  // act, so the "never on a keystroke" rule is intact.
  const ask = useCallback(async (override?: string) => {
    const question = (override ?? query).trim();
    if (!askable(question) || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setResult(null);
    setAsked(question);
    try {
      const res = await fetch("/api/journal-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json().catch(() => null)) as AskResponse | null;
      if (!res.ok || !data) {
        setError(errorFor(data?.code));
        return;
      }
      setResult(data);
    } catch {
      setError(errorFor(undefined));
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [query]);

  useEffect(() => {
    onReady?.((question?: string) => void ask(question));
  }, [onReady, ask]);

  // Bring the answer into view when it lands: on a phone the row that was
  // tapped can already be above the fold.
  useEffect(() => {
    if (result || error) {
      answerRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [result, error]);

  const clear = () => {
    setAsked(null);
    setResult(null);
    setError(null);
  };

  const showRow = askable(query) && !loading && asked !== query.trim();
  const showPanel = loading || !!result || !!error;
  // Examples only while the box is empty and nothing has been asked: they
  // are a way in, not furniture. The moment there is a query or an answer
  // on screen they are in the way, so they go.
  const showExamples =
    examples.length > 0 && query.trim() === "" && !showPanel && !asked;

  if (!showRow && !showPanel && !showExamples) return null;

  return (
    <div className="mb-3">
      {showExamples && (
        <div className="flex flex-wrap gap-1.5">
          {examples.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void ask(q)}
              className="inline-flex items-center gap-1.5 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-zinc-100"
            >
              <SparkIcon className="h-3 w-3" />
              {q}
            </button>
          ))}
        </div>
      )}
      {showRow && (
        <button
          type="button"
          onClick={() => void ask()}
          className="group flex w-full items-center gap-2.5 rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-left transition-colors hover:border-cyan-glow/50"
        >
          <SparkIcon />
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
            Ask your journal
          </span>
          <span
            aria-hidden
            className="shrink-0 text-zinc-500 transition-colors group-hover:text-cyan-glow"
          >
            ›
          </span>
        </button>
      )}

      {showPanel && (
        <div
          ref={answerRef}
          className="rounded-2xl border border-edge bg-surface p-4"
        >
          {/* The search box directly above still holds the question, so
              repeating it here is just the same sentence twice. It comes
              back only once the two have drifted apart — when someone
              starts typing the next question, the answer on screen needs
              to say which question it answered. */}
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 text-sm font-semibold text-zinc-100">
              {asked !== query.trim() ? asked : ""}
            </p>
            <button
              type="button"
              onClick={clear}
              aria-label="Close the answer"
              className="shrink-0 rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {loading && (
            <p className="mt-3 animate-pulse text-sm text-zinc-400">
              Reading your journal…
            </p>
          )}

          {error && <p className="mt-3 text-sm text-amber-300/90">{error}</p>}

          {result && <Answer result={result} />}
        </div>
      )}
    </div>
  );
}

function Answer({ result }: { result: AskResponse }) {
  const sources = result.sources ?? [];
  const numberOf = new Map(sources.map((s, i) => [s.id, i + 1] as const));
  const parts = result.answer ?? [];

  // A refusal is a correct answer, and it often arrives with no sentence
  // attached: the model has nothing to cite, so it writes nothing. The
  // words are ours rather than the model's, so a refusal reads the same
  // way every time instead of however the model felt like phrasing it.
  if (parts.length === 0) {
    const line =
      result.refused === "off_topic"
        ? "That one is outside what your journal covers."
        : result.refused === "empty"
          ? "There is nothing in your journal to answer that from yet."
          : "Your journal does not cover that yet.";
    return <p className="mt-3 text-[15px] text-zinc-300">{line}</p>;
  }

  return (
    <>
      <div className="mt-3 space-y-2.5">
        {parts.map((p, i) => (
          <p key={i} className="text-[15px] leading-relaxed text-zinc-200">
            {p.text}
            {p.sourceIds.length > 0 && (
              <span className="ml-1 align-super text-[11px] font-medium text-cyan-glow">
                {p.sourceIds
                  .map((id) => numberOf.get(id))
                  .filter(Boolean)
                  .join(",")}
              </span>
            )}
          </p>
        ))}
      </div>

      {sources.length > 0 && (
        <div className="mt-4 border-t border-edge/60 pt-3">
          <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
            Where this comes from
          </p>
          <ul className="mt-2 space-y-1.5">
            {sources.map((s, i) => (
              <li key={s.id}>
                <Link
                  href={s.href}
                  className="flex items-center gap-2.5 rounded-lg border border-edge bg-surface-2/40 px-3 py-2 transition-colors hover:border-cyan-glow/50"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-[11px] font-semibold text-cyan-glow">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {s.title}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {KIND_LABEL[s.kind]} · {shortDate(s.when)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* An answer drawn from part of the journal has to say so. */}
      {result.coverage && result.coverage !== "full" && (
        <p className="mt-3 text-xs text-zinc-500">
          {result.coverage === "takeaways"
            ? "Your journal is large, so this read the lesson summaries rather than the full transcripts."
            : "Your journal is large, so this read the last year of it."}
        </p>
      )}
    </>
  );
}

function SparkIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} shrink-0 text-cyan-glow`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.5 13.7 9l6.3 1.7-6.3 1.7L12 19l-1.7-6.6L4 10.7 10.3 9 12 2.5Z" />
      <path d="M18.5 3 19.2 5.3 21.5 6l-2.3.7-.7 2.3-.7-2.3L15.5 6l2.3-.7L18.5 3Z" opacity="0.6" />
    </svg>
  );
}
