"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  SIDE_CHOICES,
  SPIN_CHOICES,
  STRENGTH_CHOICES,
  disagrees,
  filterPoints,
  formatClock,
  isBlind,
  labeled,
  productPrefill,
  refusalText,
  serveWindow,
  summarize,
  type QueueFilter,
  type SpinMatchRow,
  type SpinNote,
  type SpinPointRow,
  type SpinPrediction,
} from "./serveSpinView";

type SaveState = "idle" | "saving" | "saved" | "error";

const RATES = [0.25, 0.5, 1] as const;

function emptyNote(pointId: string): SpinNote {
  return {
    point_id: pointId,
    spin: null,
    side: null,
    strength: null,
    note: null,
    predicted_spin: null,
    predicted_confidence: null,
    algo: null,
    blind: false,
  };
}

function Choice<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly { key: T; label: string; key_hint: string }[];
  value: T | null;
  onPick: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={value === option.key}
            onClick={() => onPick(option.key)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              value === option.key
                ? "border-cyan-glow bg-cyan-glow/15 text-cyan-glow"
                : "border-edge bg-surface-2 text-zinc-300 hover:border-zinc-500"
            }`}
          >
            {option.label}
            <span className="ml-1.5 text-[10px] text-zinc-500">
              {option.key_hint.toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const PRED_TONE: Record<string, string> = {
  top: "border-rose-400/50 bg-rose-500/10 text-rose-200",
  back: "border-sky-400/50 bg-sky-500/10 text-sky-200",
  none: "border-zinc-500/60 bg-zinc-500/10 text-zinc-300",
};

export function SpinReview({
  matches,
  predictions,
  initialNotes,
  hidden = 0,
}: {
  matches: SpinMatchRow[];
  predictions: SpinPrediction[];
  initialNotes: SpinNote[];
  /** Predictions whose point this account cannot read (a match owned by
   * someone else). Shown rather than swallowed: their videos cannot be
   * signed here either, so they are genuinely unlabelable on this login. */
  hidden?: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const predMap = useMemo(
    () => new Map(predictions.map((p) => [p.point_id, p])),
    [predictions],
  );
  const [notes, setNotes] = useState<Map<string, SpinNote>>(
    () => new Map(initialNotes.map((n) => [n.point_id, n])),
  );
  const [matchId, setMatchId] = useState(matches[0]?.matchId ?? "");
  const [filter, setFilter] = useState<QueueFilter>("unlabeled");
  const [predClass, setPredClass] = useState<
    "any" | "top" | "back" | "none" | "unmeasurable"
  >("any");
  const [pointId, setPointId] = useState<string | null>(null);
  const [forceShow, setForceShow] = useState(false);
  const [rate, setRate] = useState<number>(0.5);
  const [url, setUrl] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<"loading" | "idle" | "error">(
    "loading",
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [noteDraft, setNoteDraft] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const loopRef = useRef<{ start: number; end: number } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const match = matches.find((m) => m.matchId === matchId) ?? matches[0];
  const rows = useMemo(
    () =>
      match
        ? filterPoints(match.points, notes, predMap, filter, predClass)
        : [],
    [match, notes, predMap, filter, predClass],
  );
  const point =
    rows.find((p) => p.pointId === pointId) ??
    (match?.points ?? []).find((p) => p.pointId === pointId) ??
    rows[0] ??
    null;
  const pointRef = useRef<SpinPointRow | null>(null);
  pointRef.current = point;
  const rowsRef = useRef<SpinPointRow[]>([]);
  rowsRef.current = rows;

  const prediction = point ? predMap.get(point.pointId) : undefined;
  const note = point ? notes.get(point.pointId) : undefined;
  const allPoints = useMemo(
    () => matches.flatMap((m) => m.points),
    [matches],
  );
  const summary = useMemo(
    () => summarize(allPoints, notes, predMap),
    [allPoints, notes, predMap],
  );

  // The prediction stays hidden on the blind slice until a spin label is
  // committed; the label row records which mode it was saved under.
  const blindNow = point
    ? isBlind(point.pointId) && !forceShow && !labeled(note)
    : false;

  useEffect(() => {
    setNoteDraft(note?.note ?? "");
  }, [note?.point_id, note?.note]);

  // One signed URL per match (the whole cut video), seek per point.
  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    setUrl(null);
    setVideoState("loading");
    void (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ matchId: match.matchId, preview: true }),
        });
        const data = (await res.json()) as { url?: string };
        if (cancelled) return;
        if (!data.url) throw new Error("no url");
        setUrl(data.url);
        setVideoState("idle");
      } catch {
        if (!cancelled) setVideoState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the id, not the object: re-signing the whole cut video on
    // every re-render of an equal-but-new match object would restart the
    // player mid-label.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.matchId]);

  const playServe = useCallback(() => {
    const video = videoRef.current;
    const p = pointRef.current;
    if (!video || !p) return;
    const win = serveWindow(p, predMap.get(p.pointId));
    loopRef.current = win;
    const go = () => {
      video.currentTime = win.start;
      video.playbackRate = rate;
      void video.play().catch(() => {});
    };
    if (video.readyState >= 1) go();
    else video.addEventListener("loadedmetadata", go, { once: true });
  }, [predMap, rate]);

  const playWholePoint = useCallback(() => {
    const video = videoRef.current;
    const p = pointRef.current;
    if (!video || !p) return;
    loopRef.current = null;
    video.currentTime = Math.max(0, p.cutT0 - 1.2);
    video.playbackRate = 1;
    void video.play().catch(() => {});
  }, []);

  // Seek whenever the selected point changes.
  useEffect(() => {
    if (!url || !point) return;
    playServe();
    // Same reason: seek when the selected point actually changes, not
    // when an identical row object is recreated by a filter recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, point?.pointId, playServe]);

  // A video removed from the document keeps playing with sound.
  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
  }, [rate]);

  const save = useCallback(
    async (patch: Partial<SpinNote>) => {
      const p = pointRef.current;
      if (!p) return;
      const pred = predMap.get(p.pointId);
      const prev = notes.get(p.pointId) ?? emptyNote(p.pointId);
      const next: SpinNote = {
        ...prev,
        ...patch,
        // Snapshot what the page was showing when the label was made, so
        // agreement stays computable after the estimator re-versions.
        predicted_spin: pred?.predicted_spin ?? null,
        predicted_confidence: pred?.confidence ?? null,
        algo: pred?.algo ?? null,
        blind: prev.spin !== null ? prev.blind : isBlind(p.pointId) && !forceShow,
      };
      setNotes((map) => new Map(map).set(p.pointId, next));
      setSaveState("saving");
      const { error } = await supabase.from("spin_review_notes").upsert({
        point_id: next.point_id,
        spin: next.spin,
        side: next.side,
        strength: next.strength,
        note: next.note,
        predicted_spin: next.predicted_spin,
        predicted_confidence: next.predicted_confidence,
        algo: next.algo,
        blind: next.blind,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        setNotes((map) => new Map(map).set(p.pointId, prev));
        setSaveState("error");
        return;
      }
      setSaveState("saved");
    },
    [notes, predMap, supabase, forceShow],
  );

  const step = useCallback((delta: number) => {
    const list = rowsRef.current;
    const p = pointRef.current;
    if (!list.length) return;
    const i = Math.max(
      0,
      list.findIndex((r) => r.pointId === p?.pointId),
    );
    const next = list[Math.min(list.length - 1, Math.max(0, i + delta))];
    if (next) setPointId(next.pointId);
  }, []);

  // Keyboard: mnemonic letters save the field, Enter advances. Registered
  // on capture so keys land while focus sits inside the <video>.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const k = event.key.toLowerCase();
      const spin = SPIN_CHOICES.find((c) => c.key_hint === k);
      if (spin) {
        event.preventDefault();
        void save({ spin: spin.key });
        return;
      }
      const side = SIDE_CHOICES.find((c) => c.key_hint === k);
      if (side) {
        event.preventDefault();
        void save({ side: side.key });
        return;
      }
      const strength = STRENGTH_CHOICES.find((c) => c.key_hint === event.key);
      if (strength) {
        event.preventDefault();
        void save({ strength: strength.key });
        return;
      }
      if (event.key === "Enter" || event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === " ") {
        event.preventDefault();
        playServe();
      } else if (event.key === "n") {
        event.preventDefault();
        document.getElementById("spin-note")?.focus();
      } else if (event.key === "-") {
        setRate((r) => (r === 0.25 ? 0.5 : 0.25));
      } else if (event.key === "0") {
        setRate(1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [save, step, playServe]);

  if (!match) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
        <h1 className="text-xl font-semibold text-white">Serve spin</h1>
        <p className="mt-3 text-sm">
          No predictions yet. Run worker/build_spin_research.py first.
        </p>
      </main>
    );
  }

  const openPct = summary.totalOpen
    ? Math.round((100 * summary.agreeOpen) / summary.totalOpen)
    : null;
  const blindPct = summary.totalBlind
    ? Math.round((100 * summary.agreeBlind) / summary.totalBlind)
    : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold text-white">Serve spin</h1>
      <p className="mt-1 max-w-3xl text-sm text-zinc-400">
        Watch the serve, say what spin it carried. The estimator&apos;s call
        sits under the video; on a fixed fifth of points it stays hidden
        until you have answered, and only those blind answers make the
        honest accuracy number.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-zinc-300">
        <span className="tabular-nums">
          {summary.labeledCount} labeled of {summary.total}
        </span>
        <span className="tabular-nums text-zinc-400">
          {summary.measured} with a prediction
        </span>
        {openPct !== null && (
          <span className="tabular-nums text-zinc-400">
            agreement {openPct}% (n={summary.totalOpen})
          </span>
        )}
        {blindPct !== null && (
          <span className="tabular-nums text-cyan-100">
            blind agreement {blindPct}% (n={summary.totalBlind})
          </span>
        )}
        {hidden > 0 && (
          <span className="tabular-nums text-zinc-500">
            {hidden} hidden (match owned by another account)
          </span>
        )}
        <button
          type="button"
          onClick={() => setForceShow((v) => !v)}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            forceShow
              ? "border-amber-400/60 bg-amber-500/15 text-amber-100"
              : "border-edge text-zinc-400 hover:border-zinc-500"
          }`}
        >
          {forceShow ? "Blind holdout OFF" : "Blind holdout on"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {matches.map((m) => {
          const done = m.points.filter((p) => labeled(notes.get(p.pointId))).length;
          return (
            <button
              key={m.matchId}
              type="button"
              onClick={() => {
                setMatchId(m.matchId);
                setPointId(null);
              }}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                m.matchId === match.matchId
                  ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                  : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {m.name}
              <span className="ml-1.5 tabular-nums text-xs text-zinc-500">
                {done}/{m.points.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {(
          [
            ["unlabeled", "Unlabeled"],
            ["all", "All"],
            ["predicted", "Has prediction"],
            ["disagree", "Disagreements"],
            ["cant_tell", "Can't tell"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 transition-colors ${
              filter === key
                ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                : "border-edge text-zinc-400 hover:border-zinc-500"
            }`}
          >
            {label}
          </button>
        ))}
        <select
          value={predClass}
          onChange={(e) =>
            setPredClass(e.target.value as typeof predClass)
          }
          className="rounded-lg border border-edge bg-surface-2 px-2 py-1 text-sm text-zinc-300"
        >
          <option value="any">any prediction</option>
          <option value="top">predicted top</option>
          <option value="back">predicted back</option>
          <option value="none">predicted flat</option>
          <option value="unmeasurable">unmeasurable</option>
        </select>
      </div>

      {/* Flex, not grid-cols-[minmax(0,1fr)_320px]: the comma inside
          minmax() stops Tailwind generating the class at all. */}
      <div className="mt-4 flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="relative aspect-video overflow-hidden rounded-xl border border-edge bg-black">
            {url ? (
              <video
                ref={videoRef}
                src={url}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full"
                onTimeUpdate={(event) => {
                  const loop = loopRef.current;
                  if (loop && event.currentTarget.currentTime >= loop.end) {
                    event.currentTarget.currentTime = loop.start;
                  }
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
                {videoState === "error" ? "Video unavailable." : "Loading video…"}
              </div>
            )}
          </div>

          {point && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={playServe}
                  className="rounded-full border border-cyan-glow/60 bg-cyan-500/15 px-4 py-1.5 text-sm text-cyan-100"
                >
                  Replay the serve
                </button>
                <button
                  type="button"
                  onClick={playWholePoint}
                  className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                >
                  Play the whole point
                </button>
                {RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRate(r)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      rate === r
                        ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                        : "border-edge text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    {r}x
                  </button>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                {blindNow ? (
                  <span className="rounded-full border border-zinc-600 border-dashed px-3 py-1 text-zinc-400">
                    prediction hidden until you answer
                  </span>
                ) : prediction && prediction.predicted_spin !== "unmeasurable" ? (
                  <span
                    className={`rounded-full border px-3 py-1 ${PRED_TONE[prediction.predicted_spin]}`}
                  >
                    predicted {prediction.predicted_spin === "none" ? "flat" : prediction.predicted_spin}
                    {prediction.ratio1 != null && (
                      <span className="ml-2 tabular-nums text-xs opacity-80">
                        ratio {prediction.ratio1.toFixed(2)}
                      </span>
                    )}
                    {prediction.confidence != null && (
                      <span className="ml-2 tabular-nums text-xs opacity-80">
                        conf {prediction.confidence.toFixed(2)}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="rounded-full border border-edge px-3 py-1 text-zinc-500">
                    {refusalText(prediction) ?? "no prediction"}
                  </span>
                )}
                {!blindNow &&
                  note &&
                  prediction &&
                  labeled(note) &&
                  prediction.predicted_spin !== "unmeasurable" && (
                    <span
                      className={`rounded-full border px-3 py-1 text-xs ${
                        disagrees(note, prediction)
                          ? "border-amber-400/60 bg-amber-500/10 text-amber-200"
                          : "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                      }`}
                    >
                      {disagrees(note, prediction) ? "you disagreed" : "you agreed"}
                    </span>
                  )}
                {productPrefill(point) && (
                  <span className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-400">
                    review said: {productPrefill(point)}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="w-full lg:w-[340px]">
          {point && (
            <div className="space-y-4 rounded-xl border border-edge bg-surface-1 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-white">
                  Point #{point.idx}
                  <span className="ml-2 tabular-nums text-xs text-zinc-500">
                    {formatClock(point.cutT0)}
                  </span>
                </span>
                <span
                  className={`text-xs ${
                    saveState === "error"
                      ? "text-rose-300"
                      : saveState === "saving"
                        ? "text-zinc-400"
                        : "text-zinc-500"
                  }`}
                >
                  {saveState === "error"
                    ? "NOT saved"
                    : saveState === "saving"
                      ? "Saving…"
                      : saveState === "saved"
                        ? "Saved"
                        : ""}
                </span>
              </div>
              <Choice
                label="Spin"
                options={SPIN_CHOICES}
                value={note?.spin ?? null}
                onPick={(v) => void save({ spin: v })}
              />
              <Choice
                label="Sidespin"
                options={SIDE_CHOICES}
                value={note?.side ?? null}
                onPick={(v) => void save({ side: v })}
              />
              <Choice
                label="Strength"
                options={STRENGTH_CHOICES}
                value={note?.strength ?? null}
                onPick={(v) => void save({ strength: v })}
              />
              <div>
                <label
                  htmlFor="spin-note"
                  className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
                >
                  Note
                </label>
                <textarea
                  id="spin-note"
                  value={noteDraft}
                  onChange={(e) => {
                    setNoteDraft(e.target.value);
                    if (noteTimer.current) clearTimeout(noteTimer.current);
                    const text = e.target.value;
                    noteTimer.current = setTimeout(() => {
                      void save({ note: text || null });
                    }, 700);
                  }}
                  rows={2}
                  placeholder="Anything worth keeping."
                  className="w-full rounded-lg border border-edge bg-surface-2 px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                />
              </div>
              <p className="text-xs leading-5 text-zinc-500">
                T/B/F/U spin · A/S/D/W sidespin · 1/2 strength · Enter next
                · Space replay · N note
              </p>
            </div>
          )}

          <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-xl border border-edge">
            <div className="sticky top-0 border-b border-edge bg-surface-1 px-3 py-2 text-xs text-zinc-400">
              {rows.length} points in this filter
            </div>
            {rows.map((p) => {
              const n = notes.get(p.pointId);
              const pr = predMap.get(p.pointId);
              return (
                <button
                  key={p.pointId}
                  type="button"
                  onClick={() => setPointId(p.pointId)}
                  className={`flex w-full items-center gap-2 border-b border-edge/50 px-3 py-2 text-left text-sm transition-colors ${
                    point?.pointId === p.pointId
                      ? "bg-cyan-500/10 text-cyan-100"
                      : "text-zinc-300 hover:bg-surface-2"
                  }`}
                >
                  <span className="w-10 tabular-nums text-zinc-500">
                    #{p.idx}
                  </span>
                  <span className="w-12 tabular-nums text-xs text-zinc-500">
                    {formatClock(p.cutT0)}
                  </span>
                  <span className="flex-1 text-xs text-zinc-400">
                    {pr && pr.predicted_spin !== "unmeasurable"
                      ? isBlind(p.pointId) && !forceShow && !labeled(n)
                        ? "prediction hidden"
                        : `pred ${pr.predicted_spin === "none" ? "flat" : pr.predicted_spin}`
                      : "—"}
                  </span>
                  {isBlind(p.pointId) && (
                    <span className="text-[10px] uppercase tracking-wide text-zinc-600">
                      blind
                    </span>
                  )}
                  <span
                    className={`h-2 w-2 rounded-full ${
                      labeled(n)
                        ? disagrees(n, pr)
                          ? "bg-amber-400"
                          : "bg-emerald-400"
                        : "bg-zinc-700"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
