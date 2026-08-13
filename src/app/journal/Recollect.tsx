"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RecollectSource,
  RecollectTopicRow,
  RecollectView,
  RevealedPoint,
} from "@/lib/recollect/types";
import type { FocusPoint } from "./WorkingOn";

function sourceLabel(source: RecollectSource) {
  const kind = source.kind === "practice" ? "Practice" : "Lesson";
  // No year: this label sits in a truncating row beside two buttons, and a
  // date cut off mid-year ("Aug 9, 20…") reads as broken.
  const date = new Date(source.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${kind} · ${date}`;
}

/** "11 points from 3 lessons · last opened Jul 20" */
function topicMeta(topic: RecollectTopicRow) {
  const points = `${topic.pointCount} point${topic.pointCount === 1 ? "" : "s"}`;
  const sources = `${topic.lessonCount} entr${
    topic.lessonCount === 1 ? "y" : "ies"
  }`;
  const opened = topic.lastReviewedAt
    ? `last opened ${new Date(topic.lastReviewedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`
    : "not opened yet";
  return `${points} from ${sources} · ${opened}`;
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
  const drained = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState<Record<string, RevealedPoint[]>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<Record<string, string>>({});
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

  const retry = useCallback(() => {
    drained.current = 0;
    setError(false);
    setAttempt((n) => n + 1);
    void load().catch(() => setError(true));
  }, [load]);

  /**
   * Drain the queue while the tab is open. Nothing else processes Recollect
   * jobs — no cron, no worker — so a loop that stops early leaves the user
   * with a spinner forever. It runs until the server says there is nothing
   * available; `drained` is a backstop against a server that always claims
   * progress, not a limit on how much work a visit may do.
   */
  useEffect(() => {
    if (!view?.processing) return;
    let cancelled = false;
    void (async () => {
      try {
        while (!cancelled && drained.current < 60) {
          drained.current += 1;
          const response = await fetch("/api/recollect/process", {
            method: "POST",
          });
          if (!response.ok) throw new Error(`process ${response.status}`);
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
          if (result.status === "complete") await load();
        }
        if (!cancelled) await load();
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, view?.processing, attempt]);

  const post = useCallback(async (body: object) => {
    const response = await fetch("/api/recollect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("action failed");
    return response.json();
  }, []);

  const openTopic = async (topic: RecollectTopicRow) => {
    if (opened[topic.id] || busy.has(topic.id)) return;
    setBusy((current) => new Set(current).add(topic.id));
    try {
      // One key per topic per mount, so tapping twice cannot count as two
      // reviews and reorder the queue twice.
      let reviewKey = reviewKeys.current.get(topic.id);
      if (!reviewKey) {
        reviewKey = crypto.randomUUID();
        reviewKeys.current.set(topic.id, reviewKey);
      }
      const data = (await post({
        action: "open",
        topicId: topic.id,
        reviewKey,
      })) as { points: RevealedPoint[] };
      setOpened((current) => ({ ...current, [topic.id]: data.points ?? [] }));
      // The row's own summary line has to stop saying "not opened yet" the
      // moment it is opened. Re-ordering waits for the next visit, so the
      // list does not rearrange itself under the reader's finger.
      setView((current) =>
        current
          ? {
              ...current,
              topics: current.topics.map((row) =>
                row.id === topic.id
                  ? { ...row, lastReviewedAt: new Date().toISOString() }
                  : row,
              ),
            }
          : current,
      );
    } catch {
      setNote((current) => ({
        ...current,
        [topic.id]: "Couldn't open this one. Try again.",
      }));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(topic.id);
        return next;
      });
    }
  };

  const dismiss = async (topicId: string, pointId: string) => {
    if (busy.has(pointId)) return;
    setBusy((current) => new Set(current).add(pointId));
    try {
      await post({ action: "dismiss", pointId });
      setOpened((current) => ({
        ...current,
        [topicId]: (current[topicId] ?? []).filter(
          (point) => point.id !== pointId,
        ),
      }));
      setView((current) =>
        current
          ? {
              ...current,
              topics: current.topics.map((topic) =>
                topic.id === topicId
                  ? { ...topic, pointCount: Math.max(0, topic.pointCount - 1) }
                  : topic,
              ),
            }
          : current,
      );
    } catch {
      setNote((current) => ({
        ...current,
        [pointId]: "Couldn't remove this one. Try again.",
      }));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(pointId);
        return next;
      });
    }
  };

  const addToWorkingOn = async (topicId: string, pointId: string) => {
    if (busy.has(pointId)) return;
    setBusy((current) => new Set(current).add(pointId));
    try {
      const data = (await post({
        action: "add_to_working_on",
        pointId,
      })) as {
        result?: "added" | "duplicate" | "full";
        focus_point?: FocusPoint;
      };
      if (data.focus_point) onFocusPointAdded(data.focus_point);
      if (data.result !== "full") {
        setOpened((current) => ({
          ...current,
          [topicId]: (current[topicId] ?? []).map((point) =>
            point.id === pointId ? { ...point, inWorkingOn: true } : point,
          ),
        }));
      }
      setNote((current) => ({
        ...current,
        [pointId]:
          data.result === "full"
            ? "Working On is full — finish one first."
            : data.result === "duplicate"
              ? "Already in Working On"
              : "Added to Working On",
      }));
    } catch {
      setNote((current) => ({
        ...current,
        [pointId]: "Couldn't add this one. Try again.",
      }));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(pointId);
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
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-20 animate-pulse rounded-2xl border border-edge bg-surface"
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
          onClick={retry}
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
            Recollect groups what your lessons and practice notes covered by
            topic, so you can come back to it. You can turn it off in Account.
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

      {view.topics.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface px-6 py-10 text-center">
          {view.processing ? (
            <>
              <span className="mx-auto block h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-glow" />
              <p className="mt-3 text-sm font-medium text-zinc-300">
                Sorting your notes into topics…
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-zinc-300">
                No topics yet
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-zinc-500">
                Save a lesson or a practice note and what it covered shows up
                here, grouped by topic.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {view.topics.map((topic) => {
            const points = opened[topic.id];
            const isBusy = busy.has(topic.id);
            return (
              <li
                key={topic.id}
                className="overflow-hidden rounded-2xl border border-edge bg-surface"
              >
                <button
                  type="button"
                  onClick={() => void openTopic(topic)}
                  disabled={isBusy || Boolean(points)}
                  aria-expanded={Boolean(points)}
                  className="group flex w-full items-center gap-3 p-4 text-left disabled:cursor-default sm:p-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-medium text-zinc-100">
                      {topic.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {topicMeta(topic)}
                    </span>
                  </span>
                  {!points && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors group-hover:text-cyan-glow">
                      {isBusy ? "Opening…" : "Reveal"}
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
                  )}
                </button>

                {points && (
                  <div className="border-t border-edge/60 px-4 pb-4 sm:px-5 sm:pb-5">
                    {points.length === 0 ? (
                      <p className="pt-4 text-sm text-zinc-500">
                        Nothing left under this topic.
                      </p>
                    ) : (
                      <ul className="divide-y divide-edge/60">
                        {points.map((point) => (
                          <li key={point.id} className="py-4">
                            <p className="text-base leading-relaxed text-zinc-100">
                              {point.text}
                            </p>
                            <div className="mt-2 flex min-w-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onOpenSource(point.source)}
                                className="min-w-0 flex-1 truncate text-left text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                              >
                                {point.source.title || sourceLabel(point.source)}
                              </button>

                              {point.inWorkingOn ? (
                                <span className="shrink-0 rounded-full border border-edge px-2.5 py-1 text-[11px] font-medium text-zinc-400">
                                  Working On
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void addToWorkingOn(topic.id, point.id)
                                  }
                                  disabled={busy.has(point.id)}
                                  aria-label="Add to Working On"
                                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-edge px-3 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 disabled:opacity-60"
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.25"
                                    aria-hidden="true"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      d="M12 5v14M5 12h14"
                                    />
                                  </svg>
                                  Add
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => void dismiss(topic.id, point.id)}
                                disabled={busy.has(point.id)}
                                className="shrink-0 rounded-full border border-edge px-3 py-1 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-60"
                              >
                                Not useful
                              </button>
                            </div>
                            {note[point.id] && (
                              <p className="mt-2 text-right text-xs text-zinc-500">
                                {note[point.id]}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {topic.pointCount > points.length && points.length > 0 && (
                      <p className="pt-1 text-xs text-zinc-500">
                        {topic.pointCount - points.length} more under this
                        topic, next time.
                      </p>
                    )}
                  </div>
                )}
                {note[topic.id] && (
                  <p className="px-4 pb-4 text-xs text-zinc-500 sm:px-5">
                    {note[topic.id]}
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
