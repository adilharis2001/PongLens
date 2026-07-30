"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RecollectCardFront,
  RecollectSource,
  RecollectView,
} from "@/lib/recollect/types";
import type { FocusPoint } from "./WorkingOn";

interface RevealedCard {
  cue: string;
  source: RecollectSource;
}

function sourceLabel(source: RecollectSource) {
  const kind = source.kind === "practice" ? "Practice" : "Lesson";
  const date = new Date(source.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${kind} · ${date}`;
}

export function Recollect({
  onOpenSource,
  onFocusPointAdded,
}: {
  onOpenSource: (source: RecollectSource) => void;
  onFocusPointAdded: (focus: FocusPoint) => void;
}) {
  const [view, setView] = useState<RecollectView | null>(null);
  const [error, setError] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, RevealedCard>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Record<string, string>>({});
  const reviewKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    const response = await fetch("/api/recollect", { cache: "no-store" });
    if (!response.ok) throw new Error("load failed");
    const next = (await response.json()) as RecollectView;
    setView(next);
    setError(false);
    return next;
  }, []);

  useEffect(() => {
    void load().catch(() => setError(true));
  }, [load]);

  useEffect(() => {
    if (!view?.processing) return;
    let cancelled = false;
    void (async () => {
      // Each call handles one bounded segment. Stop when there is no
      // immediately available work so a flaky request cannot spin.
      for (let i = 0; i < 12 && !cancelled; i += 1) {
        const response = await fetch("/api/recollect/process", {
          method: "POST",
        });
        if (!response.ok) break;
        const result = (await response.json()) as {
          status?: string;
          pending?: boolean;
        };
        if (
          result.status === "idle" ||
          (result.status === "failed" && !result.pending)
        ) {
          break;
        }
      }
      if (!cancelled) await load().catch(() => setError(true));
    })();
    return () => {
      cancelled = true;
    };
  }, [load, view?.processing]);

  const post = useCallback(async (body: object) => {
    const response = await fetch("/api/recollect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("action failed");
    return response.json();
  }, []);

  const reveal = async (card: RecollectCardFront) => {
    if (revealed[card.id] || busy.has(card.id)) return;
    setBusy((current) => new Set(current).add(card.id));
    try {
      let reviewKey = reviewKeys.current.get(card.id);
      if (!reviewKey) {
        reviewKey = crypto.randomUUID();
        reviewKeys.current.set(card.id, reviewKey);
      }
      const data = (await post({
        action: "reveal",
        itemId: card.id,
        reviewKey,
      })) as RevealedCard;
      setRevealed((current) => ({ ...current, [card.id]: data }));
    } catch {
      setAdded((current) => ({
        ...current,
        [card.id]: "Couldn't reveal this one. Try again.",
      }));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(card.id);
        return next;
      });
    }
  };

  const dismiss = async (itemId: string) => {
    if (busy.has(itemId)) return;
    setBusy((current) => new Set(current).add(itemId));
    try {
      await post({ action: "dismiss", itemId });
      setView((current) =>
        current
          ? {
              ...current,
              cards: current.cards.filter((card) => card.id !== itemId),
            }
          : current,
      );
    } catch {
      setAdded((current) => ({
        ...current,
        [itemId]: "Couldn't dismiss this one. Try again.",
      }));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  };

  const addToWorkingOn = async (itemId: string) => {
    if (busy.has(itemId)) return;
    setBusy((current) => new Set(current).add(itemId));
    try {
      const data = (await post({
        action: "add_to_working_on",
        itemId,
      })) as {
        result?: "added" | "duplicate" | "full";
        focus_point?: FocusPoint;
      };
      if (data.focus_point) onFocusPointAdded(data.focus_point);
      setAdded((current) => ({
        ...current,
        [itemId]:
          data.result === "full"
            ? "Working On is full — finish one first."
            : data.result === "duplicate"
              ? "Already in Working On"
              : "Added to Working On",
      }));
    } catch {
      setAdded((current) => ({
        ...current,
        [itemId]: "Couldn't add this one. Try again.",
      }));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  };

  const acknowledge = async () => {
    setView((current) =>
      current ? { ...current, noticeSeen: true } : current,
    );
    await post({ action: "acknowledge_notice" }).catch(() => {
      setView((current) =>
        current ? { ...current, noticeSeen: false } : current,
      );
    });
  };

  if (!view && !error) {
    return (
      <div className="mt-5 space-y-3">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="h-40 animate-pulse rounded-2xl border border-edge bg-surface"
          />
        ))}
      </div>
    );
  }
  if (error || !view) {
    return (
      <div className="mt-5 rounded-2xl border border-edge bg-surface p-6 text-center">
        <p className="text-sm text-zinc-400">Recollect couldn&apos;t load.</p>
        <button
          type="button"
          onClick={() => void load().catch(() => setError(true))}
          className="mt-3 rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-200 hover:border-cyan-glow/50"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5">
      {!view.noticeSeen && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-cyan-glow/25 bg-cyan-glow/[0.06] p-4">
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-zinc-300">
            Recollect brings useful guidance from your lessons and practice
            notes back when it&apos;s worth revisiting. You can turn it off in
            Account.
          </p>
          <button
            type="button"
            onClick={() => void acknowledge()}
            className="shrink-0 rounded-full bg-cyan-glow px-3 py-1.5 text-xs font-semibold text-[#061116]"
          >
            Got it
          </button>
        </div>
      )}

      {view.cards.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface px-6 py-10 text-center">
          {view.processing ? (
            <>
              <span className="mx-auto block h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-glow" />
              <p className="mt-3 text-sm font-medium text-zinc-300">
                Preparing reminders…
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-zinc-300">
                Nothing to revisit right now
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-zinc-500">
                Useful ideas from your lessons and practice notes will return
                here when it&apos;s time.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {view.cards.map((card) => {
            const answer = revealed[card.id];
            const isBusy = busy.has(card.id);
            const source = answer?.source ?? card.source;
            return (
              <li
                key={card.id}
                className="rounded-2xl border border-edge bg-surface p-4 sm:p-5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-glow/75">
                  {card.topic}
                </p>
                {answer ? (
                  <>
                    <p className="mt-2 text-sm text-zinc-500">
                      {card.question}
                    </p>
                    <p className="mt-2 text-lg font-medium leading-relaxed text-zinc-100">
                      {answer.cue}
                    </p>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void reveal(card)}
                    disabled={isBusy}
                    className="group mt-2 block w-full rounded-xl text-left disabled:opacity-60"
                  >
                    <span className="block text-lg font-medium leading-relaxed text-zinc-100">
                      {card.question}
                    </span>
                    <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors group-hover:text-cyan-glow">
                      {isBusy ? "Opening…" : "Tap to reveal"}
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m9 6 6 6-6 6"
                        />
                      </svg>
                    </span>
                  </button>
                )}

                <div className="mt-4 flex min-w-0 items-center gap-2 border-t border-edge/60 pt-3">
                  <button
                    type="button"
                    onClick={() => onOpenSource(source)}
                    className="min-w-0 flex-1 truncate text-left text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    {source.title || sourceLabel(source)}
                    {source.title && (
                      <span className="hidden sm:inline">
                        {" "}
                        · {sourceLabel(source)}
                      </span>
                    )}
                  </button>

                  {answer && (
                    <button
                      type="button"
                      onClick={() => void addToWorkingOn(card.id)}
                      disabled={isBusy || added[card.id]?.startsWith("Added")}
                      aria-label="Add to Working On"
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-cyan-glow px-3 text-sm font-semibold text-[#061116] transition-opacity disabled:opacity-60 sm:px-4"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.25"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                      </svg>
                      <span className="hidden sm:inline">Add to Working On</span>
                      <span className="sm:hidden">Add</span>
                    </button>
                  )}

                  <details className="relative shrink-0">
                    <summary
                      aria-label="More options"
                      className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-zinc-500 hover:bg-surface-2 hover:text-zinc-200 [&::-webkit-details-marker]:hidden"
                    >
                      <span aria-hidden="true">•••</span>
                    </summary>
                    <div className="absolute right-0 top-10 z-10 w-36 rounded-xl border border-edge bg-surface-2 p-1 shadow-xl">
                      <button
                        type="button"
                        onClick={() => void dismiss(card.id)}
                        disabled={isBusy}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/5"
                      >
                        Not useful
                      </button>
                    </div>
                  </details>
                </div>
                {added[card.id] && (
                  <p className="mt-2 text-right text-xs text-zinc-500">
                    {added[card.id]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
