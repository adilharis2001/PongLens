"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cornerErrors,
  frameToSource,
  isQuad,
  polygonPoints,
  sameQuad,
  seedQuad,
  shippedProposal,
  sourceToFrame,
  summarise,
} from "./tableCalibrationView";
import type { CalibrationRow, Corner, Verdict } from "./types";

const LAYERS = [
  { key: "corrected", label: "Corrected", color: "#22d3ee" },
  { key: "keypoint", label: "Keypoint detector", color: "#f472b6" },
  { key: "luna", label: "Luna consensus", color: "#4ade80" },
  { key: "lunaTrials", label: "Luna trials", color: "#4ade80" },
  { key: "sol", label: "Sol consensus", color: "#fb923c" },
  { key: "solTrials", label: "Sol trials", color: "#fb923c" },
  { key: "production", label: "Shipped in production", color: "#a78bfa" },
] as const;
type LayerKey = (typeof LAYERS)[number]["key"];

const VERDICTS: { key: Verdict; label: string }[] = [
  { key: "correct", label: "Correct" },
  { key: "loose", label: "Loose" },
  { key: "wrong_table", label: "Wrong table" },
  { key: "no_table", label: "No table in shot" },
  { key: "unusable", label: "Not match footage" },
];

const CORNER_LABELS = ["A near-left", "B near-right", "C far-right", "D far-left"];

function Quad({
  corners,
  color,
  width,
  faint = false,
}: {
  corners: readonly Corner[];
  color: string;
  width: number;
  faint?: boolean;
}) {
  return (
    <polygon
      points={polygonPoints(corners)}
      fill={faint ? "none" : color}
      fillOpacity={faint ? 0 : 0.1}
      stroke={color}
      strokeOpacity={faint ? 0.45 : 1}
      strokeWidth={width}
      strokeDasharray={faint ? `${width * 3} ${width * 2}` : undefined}
    />
  );
}

export function TableCalibrationReview({ rows }: { rows: CalibrationRow[] }) {
  const [state, setState] = useState(rows);
  const [index, setIndex] = useState(0);
  const [filter, setFilter] = useState<"all" | "todo" | "noProposal" | "dupes">(
    "all",
  );
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<Corner[] | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    corrected: true,
    keypoint: true,
    luna: true,
    lunaTrials: false,
    sol: true,
    solTrials: false,
    production: true,
  });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<number | null>(null);

  const shown = useMemo(() => {
    if (filter === "todo") return state.filter((r) => !r.verdict);
    if (filter === "noProposal")
      return state.filter((r) => !shippedProposal(r.proposals));
    if (filter === "dupes") return state.filter((r) => r.duplicateOf);
    return state;
  }, [state, filter]);

  const row = shown[Math.min(index, Math.max(0, shown.length - 1))] ?? null;
  const summary = useMemo(() => summarise(state), [state]);

  // Frame URLs are signed for an hour and the page can outlive that, so the
  // fetch is keyed on the row rather than done once at mount.
  useEffect(() => {
    if (!row) return;
    let live = true;
    setFrameUrl(null);
    fetch(
      `/api/research/table-calibration?key=${encodeURIComponent(row.frameKey)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (live && data?.url) setFrameUrl(data.url as string);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [row]);

  useEffect(() => {
    if (!row) return;
    setDraft(
      row.correctedCorners
        ? row.correctedCorners.map((c) => sourceToFrame(c, row))
        : null,
    );
    setNotes(row.notes ?? "");
    setMessage("");
  }, [row]);

  const pointFromEvent = useCallback((event: React.PointerEvent): Corner | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(ctm.inverse());
    return [local.x, local.y];
  }, []);

  const onMove = useCallback(
    (event: React.PointerEvent) => {
      if (dragging.current === null || !row) return;
      const next = pointFromEvent(event);
      if (!next) return;
      setDraft((current) => {
        if (!current) return current;
        const copy = current.slice();
        copy[dragging.current as number] = [
          Math.max(0, Math.min(row.frameWidth, next[0])),
          Math.max(0, Math.min(row.frameHeight, next[1])),
        ];
        return copy;
      });
    },
    [pointFromEvent, row],
  );

  async function save(verdict: Verdict | null) {
    if (!row) return;
    setSaving(true);
    setMessage("");
    const corrected =
      draft && isQuad(draft) ? draft.map((c) => frameToSource(c, row)) : null;
    try {
      const res = await fetch("/api/research/table-calibration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: row.matchId,
          verdict,
          correctedCorners: corrected,
          notes: notes.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        // The route now 409s when the update matched no row, so a save that
        // silently changed nothing arrives here rather than reading as "Saved".
        throw new Error(payload?.error ?? `HTTP ${res.status}`);
      }
      // Trust the row the database sent back, not what was posted. If they
      // ever disagree, what is on screen after this is the truth.
      const saved = payload?.saved ?? null;
      setState((current) =>
        current.map((r) =>
          r.matchId === row.matchId
            ? {
                ...r,
                verdict: (saved?.verdict ?? verdict) as Verdict | null,
                notes: saved?.notes ?? (notes.trim() || null),
                correctedCorners: saved?.corrected_corners ?? corrected,
                reviewedAt: saved?.reviewed_at ?? new Date().toISOString(),
              }
            : r,
        ),
      );
      setMessage(
        corrected ? "Saved, corners included" : "Saved (no corners drawn)",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? `NOT saved: ${error.message}` : "NOT saved",
      );
    } finally {
      setSaving(false);
    }
  }

  function move(step: number) {
    const corrected =
      draft && isQuad(draft) && row
        ? draft.map((c) => frameToSource(c, row))
        : null;
    if (
      row &&
      !sameQuad(corrected, row.correctedCorners) &&
      !window.confirm("You have unsaved corner changes. Leave them behind?")
    ) {
      return;
    }
    setIndex((i) => Math.max(0, Math.min(shown.length - 1, i + step)));
  }

  if (!row) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
        <h1 className="text-xl font-semibold text-white">Table calibration</h1>
        <p className="mt-3 text-sm">
          No matches in this filter.
        </p>
      </main>
    );
  }

  const luna = row.proposals.luna;
  const sol = row.proposals.sol;
  const production = row.proposals.production;
  const keypoint = row.proposals.keypoint ?? null;
  const shipped = shippedProposal(row.proposals);
  const shippedCorners = shipped?.block.corners_source ?? null;
  const correctedSource =
    draft && isQuad(draft) ? draft.map((c) => frameToSource(c, row)) : null;
  const persisted = row.correctedCorners;
  const dirty = !sameQuad(correctedSource, persisted);
  const keypointDelta =
    keypoint?.corners_source && correctedSource
      ? cornerErrors(
          keypoint.corners_source,
          correctedSource,
          row.sourceWidth,
          row.sourceHeight,
        )
      : null;
  const delta =
    shippedCorners && correctedSource
      ? cornerErrors(
          shippedCorners,
          correctedSource,
          row.sourceWidth,
          row.sourceHeight,
        )
      : null;

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-200">
      <header className="flex flex-wrap items-center gap-4 border-b border-zinc-800 px-5 py-3">
        <h1 className="text-base font-semibold text-white">
          Table calibration
        </h1>
        <p className="text-xs text-zinc-400">
          {summary.total} matches · Luna agreed {summary.lunaAgreed} · Sol run
          on {summary.solRun}, agreed {summary.solAgreed} · neither{" "}
          {summary.noProposal} · duplicates {summary.duplicates} · reviewed{" "}
          {summary.reviewed}
        </p>
        <div className="ml-auto flex gap-1.5">
          {(
            [
              ["all", "All"],
              ["todo", "Not reviewed"],
              ["noProposal", "No proposal"],
              ["dupes", "Duplicates"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setFilter(key);
                setIndex(0);
              }}
              className={`rounded-full border px-3 py-1 text-xs ${
                filter === key
                  ? "border-cyan-400 text-cyan-300"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black">
            {frameUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={frameUrl}
                alt={`frame for match ${row.matchId}`}
                className="block w-full"
              />
            ) : (
              <div className="aspect-video w-full animate-pulse bg-zinc-900" />
            )}
            <svg
              ref={svgRef}
              viewBox={`0 0 ${row.frameWidth} ${row.frameHeight}`}
              className="absolute inset-0 h-full w-full touch-none"
              onPointerMove={onMove}
              onPointerUp={() => (dragging.current = null)}
              onPointerLeave={() => (dragging.current = null)}
            >
              {visible.production && production?.ok && production.corners_source && (
                <Quad
                  corners={production.corners_source.map((c) =>
                    sourceToFrame(c, row),
                  )}
                  color="#a78bfa"
                  width={row.frameWidth / 400}
                />
              )}
              {visible.lunaTrials &&
                luna?.trials.map((trial, i) =>
                  trial.corners_source ? (
                    <Quad
                      key={`lt${i}`}
                      faint
                      corners={trial.corners_source.map((c) =>
                        sourceToFrame(c, row),
                      )}
                      color="#4ade80"
                      width={row.frameWidth / 700}
                    />
                  ) : null,
                )}
              {visible.solTrials &&
                sol?.trials.map((trial, i) =>
                  trial.corners_source ? (
                    <Quad
                      key={`st${i}`}
                      faint
                      corners={trial.corners_source.map((c) =>
                        sourceToFrame(c, row),
                      )}
                      color="#fb923c"
                      width={row.frameWidth / 700}
                    />
                  ) : null,
                )}
              {visible.sol && sol?.corners_source && (
                <Quad
                  corners={sol.corners_source.map((c) => sourceToFrame(c, row))}
                  color="#fb923c"
                  width={row.frameWidth / 400}
                />
              )}
              {visible.keypoint && keypoint?.corners_source && (
                <Quad
                  corners={keypoint.corners_source.map((c) =>
                    sourceToFrame(c, row),
                  )}
                  color="#f472b6"
                  width={row.frameWidth / 400}
                />
              )}
              {visible.luna && luna?.corners_source && (
                <Quad
                  corners={luna.corners_source.map((c) => sourceToFrame(c, row))}
                  color="#4ade80"
                  width={row.frameWidth / 400}
                />
              )}
              {visible.corrected && draft && (
                <>
                  <Quad
                    corners={draft}
                    color="#22d3ee"
                    width={row.frameWidth / 320}
                  />
                  {draft.map(([x, y], i) => (
                    <g key={`c${i}`}>
                      <circle
                        cx={x}
                        cy={y}
                        r={row.frameWidth / 90}
                        fill="#0b1120"
                        stroke="#22d3ee"
                        strokeWidth={row.frameWidth / 400}
                        className="cursor-grab"
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          dragging.current = i;
                        }}
                      />
                      <text
                        x={x}
                        y={y + row.frameWidth / 250}
                        textAnchor="middle"
                        fill="#22d3ee"
                        fontSize={row.frameWidth / 70}
                        fontWeight="700"
                        pointerEvents="none"
                      >
                        {"ABCD"[i]}
                      </text>
                    </g>
                  ))}
                </>
              )}
            </svg>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {LAYERS.map((layer) => (
              <button
                key={layer.key}
                onClick={() =>
                  setVisible((v) => ({ ...v, [layer.key]: !v[layer.key] }))
                }
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                  visible[layer.key]
                    ? "border-zinc-600 text-zinc-200"
                    : "border-zinc-800 text-zinc-600"
                }`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    background: visible[layer.key] ? layer.color : "#3f3f46",
                  }}
                />
                {layer.label}
              </button>
            ))}
          </div>
        </section>

        <aside className="space-y-4 text-sm">
          <div className="rounded-xl border border-zinc-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <code className="text-xs text-zinc-500">
                {row.matchId.slice(0, 8)}
              </code>
              <span className="text-xs text-zinc-500">
                {index + 1} of {shown.length}
              </span>
            </div>
            <p className="mt-1.5 font-medium text-white">
              {row.venue || "No venue"} · vs {row.opponent || "unnamed"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {row.originalName || "no filename"} · placement:{" "}
              {row.placementStatus ?? "unknown"}
            </p>
            {row.duplicateOf && (
              <p className="mt-2 rounded-lg bg-amber-950/40 px-2 py-1.5 text-xs text-amber-300">
                Same video as {row.duplicateOf.slice(0, 8)} —{" "}
                {row.duplicateReason}
              </p>
            )}
          </div>

          <div className="space-y-1.5 rounded-xl border border-zinc-800 p-3 text-xs">
            <p className="font-medium text-zinc-300">What each model did</p>
            <p className="text-zinc-400">
              <span className="text-emerald-400">Luna</span>:{" "}
              {luna
                ? luna.accepted
                  ? `agreed, max drift ${luna.max_drift_ratio}`
                  : `no consensus (${luna.reason})`
                : "not run"}
            </p>
            <p className="text-zinc-400">
              <span className="text-orange-400">Sol</span>:{" "}
              {sol
                ? sol.accepted
                  ? `agreed, max drift ${sol.max_drift_ratio}`
                  : `no consensus (${sol.reason})`
                : "not run — Luna agreed, so Sol was not bought"}
            </p>
            <p className="text-zinc-400">
              <span className="text-violet-400">Production</span>:{" "}
              {production?.ok ? production.note ?? "stored" : "no quad stored"}
            </p>
            <p className="text-zinc-400">
              <span className="text-pink-400">Keypoint</span>:{" "}
              {keypoint?.corners_source
                ? "local Segformer++ fit, no API cost"
                : "not run"}
            </p>
            {keypointDelta && (
              <p className="pt-1 text-pink-300">
                Keypoint vs your correction: median{" "}
                {keypointDelta.median.toFixed(1)}px, max{" "}
                {keypointDelta.max.toFixed(1)}px
              </p>
            )}
            {delta && (
              <p className="pt-1 text-zinc-300">
                Shipped ({shipped?.model}) vs your correction: median{" "}
                {delta.median.toFixed(1)}px, max {delta.max.toFixed(1)}px
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                setDraft(
                  shippedCorners
                    ? shippedCorners.map((c) => sourceToFrame(c, row))
                    : [...seedQuad(row.frameWidth, row.frameHeight)],
                )
              }
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs hover:border-zinc-500"
            >
              {shippedCorners ? "Start from shipped quad" : "Start a quad"}
            </button>
            <button
              onClick={() =>
                setDraft([...seedQuad(row.frameWidth, row.frameHeight)])
              }
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs hover:border-zinc-500"
            >
              Blank quad
            </button>
            {draft && (
              <button
                onClick={() => setDraft(null)}
                className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500"
              >
                Clear
              </button>
            )}
          </div>
          {/* Never left implicit again. The first 62 marks were drawn
              without this said anywhere, and on 7 of them the letters
              started one position round — A-B along a side line instead of
              the end line — which took a migration and two independent
              geometric tests to unpick. */}
          {draft && (
            <div className="space-y-1 text-xs text-zinc-500">
              <p>Drag {CORNER_LABELS.join(", ")} onto the playing surface.</p>
              <p>
                <span className="text-zinc-300">A</span> and{" "}
                <span className="text-zinc-300">B</span> are the two ends of
                the end line nearest the camera, A on the left and B on the
                right as the camera sees it.{" "}
                <span className="text-zinc-300">C</span> and{" "}
                <span className="text-zinc-300">D</span> are the far end, C
                on the right and D on the left. So A to B is always a short
                edge and B to C is always a long one.
              </p>
            </div>
          )}

          {/* The one thing this page must never be vague about. A correction
              that was not stored is worse than no correction, because it
              looks like evidence. */}
          <div
            className={`rounded-xl border px-3 py-2.5 text-xs ${
              dirty
                ? "border-amber-500/60 bg-amber-950/30 text-amber-200"
                : persisted
                  ? "border-emerald-600/50 bg-emerald-950/25 text-emerald-200"
                  : "border-zinc-800 text-zinc-400"
            }`}
          >
            <p className="font-medium">
              {dirty
                ? "Unsaved corner changes"
                : persisted
                  ? "Corners saved in the database"
                  : "No corrected corners saved for this match"}
            </p>
            {row.reviewedAt && (
              <p className="mt-0.5 opacity-80">
                Last written {new Date(row.reviewedAt).toLocaleString()}
                {row.verdict ? ` · verdict "${row.verdict}"` : ""}
              </p>
            )}
            <button
              disabled={saving || !dirty}
              onClick={() => save(row.verdict)}
              className="mt-2 rounded-full border border-current px-3 py-1.5 font-medium disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save corners"}
            </button>
            {message && <p className="mt-1.5 opacity-90">{message}</p>}
          </div>

          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What is wrong with this one?"
            rows={3}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
          />

          <div className="flex flex-wrap gap-2">
            {VERDICTS.map((verdict) => (
              <button
                key={verdict.key}
                disabled={saving}
                onClick={() => save(verdict.key)}
                className={`rounded-full border px-3 py-1.5 text-xs ${
                  row.verdict === verdict.key
                    ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {verdict.label}
              </button>
            ))}
          </div>

          {/* Navigating away rebuilds the draft from the stored row, so an
              unsaved drag is gone the moment the index changes. Ask first. */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => move(-1)}
              disabled={index === 0}
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => move(1)}
              disabled={index >= shown.length - 1}
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
