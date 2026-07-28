"use client";

import {
  Table,
  makeMapXY,
  YOU_COLOR,
  THEM_COLOR,
} from "@/app/match/[id]/placementTable";

/*
 * Live persona cards — real HTML instead of screenshots, so the "Who
 * it's for" section is legible at any size. The ball map renders through
 * the product's actual Table primitive; the share sheet and coach thread
 * are static replicas that reuse the app's exact styling vocabulary.
 * Content mirrors the staged demo account.
 */

const shareRows = [
  { icon: "★", tone: "text-yellow-400", title: "Starred points (3)", sub: "Public link · updates as you star" },
  { icon: "⌁", tone: "text-cyan-glow", title: "footwork (2)", sub: "Public link · updates as you tag" },
  { icon: "⌁", tone: "text-cyan-glow", title: "third ball attack (2)", sub: "Public link · updates as you tag" },
  { icon: "▶", tone: "text-cyan-glow", title: "This match", sub: "Public link" },
  { icon: "◎", tone: "text-amber-300", title: "With your coach", sub: "Private invite · they can add notes" },
];

export function ShareCard() {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-5 shadow-2xl shadow-black/50">
      <p className="text-base font-semibold">Share</p>
      <p className="mt-1 text-xs text-zinc-500">
        Anyone with the link can watch. Revoke it anytime from your account.
      </p>
      <div className="mt-4 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-ink/30">
        {shareRows.map((r) => (
          <div
            key={r.title}
            className="flex min-h-[3.25rem] items-center gap-3 px-4 py-3"
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-edge text-sm ${r.tone}`}
              aria-hidden
            >
              {r.icon}
            </span>
            <span className="min-w-0">
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

export function MapCard() {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-5 shadow-2xl shadow-black/50">
      <p className="text-base font-semibold">Where the ball landed</p>
      <p className="mt-1 text-xs text-zinc-500">
        Serves from both sides, across the whole match.
      </p>
      <div className="mx-auto mt-4 max-w-[15rem]">
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
      <p className="mt-2 text-center text-xs text-zinc-500">
        <span style={{ color: YOU_COLOR }}>●</span> my serves{" "}
        <span className="ml-3" style={{ color: THEM_COLOR }}>●</span> their
        serves
      </p>
    </div>
  );
}

const thread = [
  {
    author: "Miguel Santos",
    coach: true,
    when: "Point 5",
    text: "Strong first game. Serve variation won you the close points, keep opening with it.",
  },
  {
    author: "You",
    coach: false,
    when: "Point 8",
    text: "Best rally of the night. The wide block set up the counter.",
  },
  {
    author: "Miguel Santos",
    coach: true,
    when: "Point 12",
    text: "You backed off the table here. Hold your ground on the third ball.",
  },
];

export function CoachThreadCard() {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-5 shadow-2xl shadow-black/50">
      <p className="text-base font-semibold">Notes</p>
      <div className="mt-4 space-y-4">
        {thread.map((n) => (
          <div
            key={`${n.author}${n.when}`}
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
            <p className="mt-1 text-sm leading-relaxed text-zinc-200">
              {n.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
