"use client";

import {
  Table,
  makeMapXY,
  YOU_COLOR,
  THEM_COLOR,
} from "@/app/match/[id]/placementTable";

/*
 * "Who it's for" glances — live HTML fragments, deliberately unboxed:
 * each column of the section gets a small real-looking piece of the
 * product (share rows, the placement table, a note thread) that stays
 * legible at any size without card chrome around it.
 */

const shareRows = [
  { icon: "★", tone: "text-yellow-400", title: "Starred points (3)", sub: "Public link · updates as you star" },
  { icon: "⌁", tone: "text-cyan-glow", title: "footwork (2)", sub: "Public link · updates as you tag" },
  { icon: "▶", tone: "text-cyan-glow", title: "This match", sub: "Public link" },
];

// The glance renders as an INSET TILE at the top of its persona card
// (bento style: visual first, then headline, then copy — one unit). The
// fixed min-height keeps the three tiles equal; content centers in it.
const frame =
  "flex w-full flex-col justify-center rounded-xl border border-edge bg-ink/40 p-4 text-left";
const frameStyle = { minHeight: "15.5rem" };

export function ShareGlance() {
  return (
    <div className={frame} style={frameStyle}>
      <p className="text-sm font-semibold">Share</p>
      <div className="mt-3 space-y-3.5">
      {shareRows.map((r) => (
        <div key={r.title} className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge text-sm ${r.tone}`}
            aria-hidden
          >
            {r.icon}
          </span>
          <span className="min-w-0 text-left">
            <span className="block text-sm font-medium text-zinc-100">
              {r.title}
            </span>
            <span className="block text-xs text-zinc-500">{r.sub}</span>
          </span>
        </div>
      ))}
      </div>
    </div>
  );
}

// Staged landings (meters): my serves into the wide corners, theirs long
// through the middle — the same shapes the demo match shows.
const mapXY = makeMapXY("near");
const MY_SERVES: [number, number][] = [
  [0.28, 2.45], [0.33, 2.52], [0.24, 2.38], [1.22, 1.62], [1.3, 1.55],
  [1.26, 1.7], [0.72, 2.2], [0.66, 2.32], [1.18, 2.48], [1.24, 2.55],
];
const THEIR_SERVES: [number, number][] = [
  [0.62, 0.42], [0.7, 0.35], [0.55, 0.5], [0.78, 0.44], [0.4, 0.55],
  [0.45, 0.38], [1.05, 0.9], [0.68, 0.6],
];

export function MapGlance() {
  return (
    <div className={frame} style={frameStyle}>
      <p className="text-sm font-semibold">Where the ball landed</p>
      <div className="mx-auto mt-2 w-28">
      <Table topLabel="Alex" bottomLabel="Me">
        {MY_SERVES.map(([u, v], i) => {
          const { x, y } = mapXY(u, v);
          return (
            <circle key={`m${i}`} cx={x} cy={y} r="5" fill={YOU_COLOR}
              fillOpacity="0.55" stroke="#0c1222" strokeWidth="0.75" />
          );
        })}
        {THEIR_SERVES.map(([u, v], i) => {
          const { x, y } = mapXY(u, v);
          return (
            <circle key={`t${i}`} cx={x} cy={y} r="5" fill={THEM_COLOR}
              fillOpacity="0.55" stroke="#0c1222" strokeWidth="0.75" />
          );
        })}
      </Table>
      </div>
    </div>
  );
}

const thread = [
  {
    author: "Miguel Santos",
    coach: true,
    when: "Point 5",
    text: "Serve variation won you the close points, keep opening with it.",
  },
  {
    author: "You",
    coach: false,
    when: "Point 8",
    text: "Best rally of the night. The wide block set up the counter.",
  },
];

export function CoachGlance() {
  return (
    <div className={frame} style={frameStyle}>
      <p className="text-sm font-semibold">Notes</p>
      <div className="mt-3 space-y-3.5">
      {thread.map((n) => (
        <div
          key={n.author}
          className={`border-l-2 py-0.5 pl-3.5 ${
            n.coach ? "border-amber-400/50" : "border-cyan-glow/40"
          }`}
        >
          <p
            className={`text-xs font-medium ${
              n.coach ? "text-amber-300" : "text-zinc-400"
            }`}
          >
            {n.author} <span className="text-zinc-600">· {n.when}</span>
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            {n.text}
          </p>
        </div>
      ))}
      </div>
    </div>
  );
}
