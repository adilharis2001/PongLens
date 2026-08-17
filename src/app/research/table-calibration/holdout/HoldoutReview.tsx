"use client";

import { useEffect, useMemo, useState } from "react";
import type { Corner, HoldoutRow, Verdict } from "./types";

const VERDICTS: { key: Verdict; label: string; key_hint: string }[] = [
  { key: "correct", label: "Correct", key_hint: "1" },
  { key: "loose", label: "Loose", key_hint: "2" },
  { key: "wrong_table", label: "Wrong table", key_hint: "3" },
  { key: "no_table", label: "No table in shot", key_hint: "4" },
  { key: "unusable", label: "Not match footage", key_hint: "5" },
];

/** One image, one outline, one judgement. Nothing else is drawn: this is a
 *  holdout, and showing what any other detector proposed would tell the
 *  reviewer what answer to expect. */
export function HoldoutReview({ rows }: { rows: HoldoutRow[] }) {
  const [state, setState] = useState(rows);
  const [index, setIndex] = useState(0);
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const shown = useMemo(
    () => (onlyTodo ? state.filter((r) => !r.verdict) : state),
    [state, onlyTodo],
  );
  const row = shown[Math.min(index, Math.max(0, shown.length - 1))] ?? null;
  const done = state.filter((r) => r.verdict).length;

  useEffect(() => {
    if (!row) return;
    let live = true;
    setUrl(null);
    setMessage("");
    fetch(
      `/api/research/table-calibration/holdout?key=${encodeURIComponent(row.frame_key)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (live && data?.url) setUrl(data.url as string);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [row]);

  async function save(verdict: Verdict) {
    if (!row) return;
    setSaving(true);
    try {
      const res = await fetch("/api/research/table-calibration/holdout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, verdict, notes: row.notes }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`);
      setState((current) =>
        current.map((r) =>
          r.id === row.id
            ? { ...r, verdict, reviewed_at: new Date().toISOString() }
            : r,
        ),
      );
      setMessage("Saved");
      // Grading a hundred frames is only bearable if it advances itself.
      setIndex((i) => Math.min(shown.length - 1, i + 1));
    } catch (error) {
      setMessage(
        error instanceof Error ? `NOT saved: ${error.message}` : "NOT saved",
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLTextAreaElement) return;
      const hit = VERDICTS.find((v) => v.key_hint === event.key);
      if (hit) {
        void save(hit.key);
        return;
      }
      if (event.key === "ArrowRight")
        setIndex((i) => Math.min(shown.length - 1, i + 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!row) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
        <h1 className="text-xl font-semibold text-white">
          Table calibration holdout
        </h1>
        <p className="mt-3 text-sm">
          {state.length === 0
            ? "No frames yet. The overnight batch has not landed."
            : "Every frame in this filter is graded."}
        </p>
      </main>
    );
  }

  // The frame is served at its stored size; the quad is in source pixels.
  const sx = row.frame_width / row.source_width;
  const sy = row.frame_height / row.source_height;
  const points = (row.quad ?? [])
    .map((c: Corner) => `${(c[0] * sx).toFixed(1)},${(c[1] * sy).toFixed(1)}`)
    .join(" ");

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-200">
      <header className="flex flex-wrap items-center gap-4 border-b border-zinc-800 px-5 py-3">
        <h1 className="text-base font-semibold text-white">
          Table calibration holdout
        </h1>
        <p className="text-xs text-zinc-400">
          {done} of {state.length} graded · frames the detector has never been
          tuned on
        </p>
        <button
          onClick={() => {
            setOnlyTodo((v) => !v);
            setIndex(0);
          }}
          className={`ml-auto rounded-full border px-3 py-1 text-xs ${
            onlyTodo
              ? "border-cyan-400 text-cyan-300"
              : "border-zinc-700 text-zinc-400"
          }`}
        >
          {onlyTodo ? "Showing ungraded" : "Show ungraded only"}
        </button>
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`frame ${row.frame_index}`} className="block w-full" />
          ) : (
            <div className="aspect-video w-full animate-pulse bg-zinc-900" />
          )}
          {row.quad && (
            <svg
              viewBox={`0 0 ${row.frame_width} ${row.frame_height}`}
              className="absolute inset-0 h-full w-full"
            >
              <polygon
                points={points}
                fill="#f472b6"
                fillOpacity={0.12}
                stroke="#f472b6"
                strokeWidth={row.frame_width / 350}
              />
            </svg>
          )}
          {!row.quad && (
            <p className="absolute left-3 top-3 rounded bg-amber-950/80 px-2 py-1 text-xs text-amber-300">
              The detector declined this frame
            </p>
          )}
        </div>

        <aside className="space-y-4 text-sm">
          <div className="rounded-xl border border-zinc-800 p-3">
            <div className="flex justify-between text-xs text-zinc-500">
              <code>{row.match_id.slice(0, 8)}</code>
              <span>
                {index + 1} of {shown.length}
              </span>
            </div>
            <p className="mt-1.5 font-medium text-white">
              {row.venue || "No venue"} · vs {row.opponent_name || "unnamed"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              frame {row.frame_index}
              {row.frame_time_s != null
                ? ` at ${row.frame_time_s.toFixed(0)}s`
                : ""}
            </p>
            {row.verdict && (
              <p className="mt-2 text-xs text-cyan-300">
                Graded &ldquo;{row.verdict}&rdquo;
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {VERDICTS.map((verdict) => (
              <button
                key={verdict.key}
                disabled={saving}
                onClick={() => save(verdict.key)}
                className={`flex items-center justify-between rounded-full border px-3 py-2 text-xs ${
                  row.verdict === verdict.key
                    ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {verdict.label}
                <kbd className="text-zinc-600">{verdict.key_hint}</kbd>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setIndex((i) => Math.min(shown.length - 1, i + 1))}
              disabled={index >= shown.length - 1}
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Next
            </button>
            <span className="text-xs text-zinc-500">{message}</span>
          </div>
          <p className="text-xs text-zinc-600">
            Keys 1–5 grade and advance. Arrows move without grading.
          </p>
        </aside>
      </div>
    </main>
  );
}
