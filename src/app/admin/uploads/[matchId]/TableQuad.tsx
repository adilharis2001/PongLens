"use client";

import { useEffect, useRef, useState } from "react";
import {
  CORNER_LABELS,
  DETECTOR_WARNINGS,
  polygonPoints,
  type TableReading,
} from "../uploadView";

/**
 * The table the pipeline found, drawn on the footage it found it in.
 *
 * THE SCALING TRAP, AND WHY IT CANNOT FIRE HERE. Corners are measured in
 * SOURCE pixels (1920x1080, say) while point clips are re-encoded to 720
 * wide. Every previous overlay in this codebase converted between the two
 * with a scale factor, and getting that factor wrong offsets the quad by
 * twenty percent while still drawing a perfectly plausible table.
 *
 * There is no factor here. The SVG's viewBox IS the source frame, so the
 * browser does the scaling, and the corners go in raw. The same component
 * is therefore correct over the cut (source-sized) and over a 720-wide
 * clip, because both are the same picture at different sizes and no
 * arithmetic was written to get wrong.
 *
 * The box carries the source aspect ratio and is sized on the div, never
 * on the <video> — a media element has no intrinsic size until its
 * metadata arrives, so a self-sized video starts at the spec's 300x150 and
 * visibly jumps. With the ratio on the wrapper the video fills it exactly,
 * so the SVG's inset-0 box is the picture box and not an element box with
 * black bands beside the picture.
 */

export function TableQuad({
  table,
  videoUrl,
  seekS,
  sourceWidth,
  sourceHeight,
}: {
  table: TableReading;
  /** The cut video, or the original when there is no cut. Null when
   *  neither exists — the page still explains the calibration. */
  videoUrl: string | null;
  /** Where to park the frame: inside the first rally, so the table is
   *  actually in shot rather than a shot of an empty hall. */
  seekS: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
}) {
  const [showQuad, setShowQuad] = useState(true);
  const ref = useRef<HTMLVideoElement | null>(null);

  // A <video> removed from the document keeps playing, with sound. This one
  // never plays, but it is muted and paused defensively all the same — the
  // rule has been broken often enough here to be worth the two lines.
  useEffect(() => {
    const el = ref.current;
    return () => {
      el?.pause();
    };
  }, []);

  const w = sourceWidth ?? 1920;
  const h = sourceHeight ?? 1080;
  const quad = table.quad;
  const warning = table.detector
    ? DETECTOR_WARNINGS[table.detector] ?? null
    : null;

  return (
    <section className="mt-4">
      <div
        className="relative w-full overflow-hidden bg-black sm:rounded-2xl"
        style={{ aspectRatio: `${w} / ${h}` }}
      >
        {videoUrl ? (
          <video
            ref={ref}
            // #t= parks the frame without a play(). preload="metadata"
            // alone would show frame zero, which on a match that opens
            // with an empty table is a picture of nothing.
            src={`${videoUrl}#t=${seekS.toFixed(2)}`}
            preload="metadata"
            muted
            playsInline
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="px-6 text-center text-sm text-zinc-500">
              No video to show this on.
            </p>
          </div>
        )}

        {quad && showQuad && (
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-label="The table the pipeline detected"
          >
            <polygon
              points={polygonPoints(quad)}
              fill="#22d3ee"
              fillOpacity={0.12}
              stroke="#22d3ee"
              strokeWidth={w / 400}
            />
            {/* A→B is the NEAR end line, always. Drawn heavier so which end
                the camera is closest to reads without counting letters. */}
            <line
              x1={quad[0][0]}
              y1={quad[0][1]}
              x2={quad[1][0]}
              y2={quad[1][1]}
              stroke="#22d3ee"
              strokeWidth={w / 170}
            />
            {quad.map((c, i) => (
              <g key={CORNER_LABELS[i]}>
                <circle cx={c[0]} cy={c[1]} r={w / 160} fill="#f472b6" />
                {/* Painted twice: a dark stroke under the fill. A single
                    pink glyph disappears against the pale table and the
                    hall lights behind it, and this label is the whole
                    point of drawing corners rather than just an outline. */}
                <text
                  x={c[0] + w / 80}
                  y={c[1] - w / 90}
                  fontSize={w / 26}
                  fontWeight={700}
                  stroke="#000"
                  strokeWidth={w / 200}
                  strokeLinejoin="round"
                  fill="none"
                >
                  {CORNER_LABELS[i]}
                </text>
                <text
                  x={c[0] + w / 80}
                  y={c[1] - w / 90}
                  fontSize={w / 26}
                  fontWeight={700}
                  fill="#f9a8d4"
                >
                  {CORNER_LABELS[i]}
                </text>
              </g>
            ))}
          </svg>
        )}

        {quad && (
          <button
            type="button"
            onClick={() => setShowQuad((v) => !v)}
            className="absolute right-3 top-3 rounded-full border border-white/25 bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur transition-colors hover:border-white/50"
          >
            {showQuad ? "Hide table" : "Show table"}
          </button>
        )}
      </div>

      <div className="px-4 sm:px-0">
        {table.state === "detected" && (
          <>
            <p className="mt-3 text-sm text-zinc-300">
              A is the near-left corner, B near-right, C far-right, D
              far-left. The heavy line is the near end.
            </p>
            {table.note && (
              <p className="mt-1 text-sm text-zinc-500">{table.note}</p>
            )}
            {table.agreement && <Agreement a={table.agreement} />}
            {warning && (
              <p className="mt-2 text-sm text-amber-300">{warning}</p>
            )}
          </>
        )}

        {table.state === "refused" && (
          <p className="mt-3 text-sm text-zinc-300">
            No table found, so none is drawn. Points, clips and scoring
            never needed one — only placement maps did.
            {table.note ? ` ${table.note}` : ""}
          </p>
        )}

        {table.state === "unknown" && (
          <p className="mt-3 text-sm text-zinc-300">
            This upload has no processing record, so there is nothing to say
            about a table.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * How sure the detector was. Sixteen frames are sampled, some are thrown
 * out, and the rest have to agree: one frame alone is wrong 13% of the
 * time and sixteen is wrong 0.2%. Spread is how far apart the surviving
 * frames put the same corner, so a large one means they agreed on a table
 * without agreeing on where it was.
 *
 * Absent on every vision-calibrated match — that path records no agreement
 * at all — so the row renders only when there is something in it.
 */
function Agreement({
  a,
}: {
  a: NonNullable<TableReading["agreement"]>;
}) {
  const spread = a.spread_px;
  const wide = typeof spread === "number" && spread > 12;
  const items = [
    a.frames_used != null && a.frames_sampled != null
      ? `${a.frames_used} of ${a.frames_sampled} frames used`
      : null,
    typeof spread === "number" ? `${spread.toFixed(1)}px spread` : null,
    a.tables_seen != null ? `${a.tables_seen} tables in shot` : null,
  ].filter(Boolean) as string[];
  if (items.length === 0) return null;
  return (
    <p className={`mt-1 text-sm ${wide ? "text-amber-300" : "text-zinc-500"}`}>
      {items.join(" · ")}
      {wide && " — the frames disagreed on where the corners were."}
    </p>
  );
}
