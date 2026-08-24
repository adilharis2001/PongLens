"use client";

import { useCallback, useMemo, useState } from "react";
import {
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
} from "@/lib/placement/placementAggregate";
import {
  REJECTION_COPY,
  summarise,
  type ServeAccuracyMatch,
  type ServeAccuracyRow,
} from "./serveAccuracyModel";

/**
 * Every point, its clip, and the two dots the app draws from it.
 *
 * The serve map claims a serve landed somewhere. The only way to find out
 * whether it did is to watch the rally and look. So each row is the clip
 * beside the dots, at a size where a table-tennis ball is visible, with
 * the refusals shown too — a refusal is also a claim, and one nobody has
 * checked is one nobody can trust.
 *
 * The final-shot dot is here to be judged, not believed. Nothing about it
 * has been measured; it is the last shot with a landing, drawn ungated.
 */

const VIEW_W = 150;
const VIEW_H = 232;
const TX = 22;
const TY = 26;
const TW = 106;
const TH = 182;

function Court({
  serve,
  final,
  topLabel,
  bottomLabel,
}: {
  serve: { u: number; v: number } | null;
  final: { u: number; v: number; shotSeq: number } | null;
  topLabel: string;
  bottomLabel: string;
}) {
  const xy = (u: number, v: number) => ({
    x: TX + (TW * u) / TABLE_WIDTH_M,
    y: TY + TH * (1 - v / TABLE_LENGTH_M),
  });
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full">
      <text x={VIEW_W / 2} y={14} textAnchor="middle" fontSize="9" fill="#71717a">
        {topLabel}
      </text>
      <rect
        x={TX}
        y={TY}
        width={TW}
        height={TH}
        rx="4"
        fill="#0f2557"
        stroke="#cbd5e1"
        strokeWidth="1.5"
      />
      <line
        x1={TX}
        y1={TY + TH / 2}
        x2={TX + TW}
        y2={TY + TH / 2}
        stroke="#f8fafc"
        strokeWidth="1.75"
        strokeDasharray="4 2"
      />
      <line
        x1={TX + TW / 2}
        y1={TY}
        x2={TX + TW / 2}
        y2={TY + TH}
        stroke="#cbd5e1"
        strokeOpacity="0.4"
        strokeWidth="0.75"
      />
      {final && (
        <circle
          {...(({ x, y }) => ({ cx: x, cy: y }))(xy(final.u, final.v))}
          r="5"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2"
        />
      )}
      {serve && (
        <circle
          {...(({ x, y }) => ({ cx: x, cy: y }))(xy(serve.u, serve.v))}
          r="4.5"
          fill="#22d3ee"
          fillOpacity="0.85"
          stroke="#0c1222"
          strokeWidth="1"
        />
      )}
      <text
        x={VIEW_W / 2}
        y={VIEW_H - 6}
        textAnchor="middle"
        fontSize="9"
        fill="#71717a"
      >
        {bottomLabel}
      </text>
      <text x={TX} y={TY + TH + 11} fontSize="7" fill="#52525b">
        your left
      </text>
      <text
        x={TX + TW}
        y={TY + TH + 11}
        fontSize="7"
        fill="#52525b"
        textAnchor="end"
      >
        your right
      </text>
    </svg>
  );
}

function Row({
  row,
  matchId,
  opponent,
}: {
  row: ServeAccuracyRow;
  matchId: string;
  opponent: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const load = useCallback(async () => {
    if (url) return;
    setState("loading");
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, pointId: row.pointId }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      setUrl(data.url);
      setState("idle");
    } catch {
      setState("error");
    }
  }, [matchId, row.pointId, url]);

  const served = row.server === "user" ? "You" : opponent;
  const won =
    row.isLet ? "let" : row.winner === null ? "unscored"
      : row.winner === "user" ? "you won" : `${opponent} won`;

  return (
    <div className="rounded-xl border border-edge bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-zinc-100">
          Point {row.idx}
          <span className="ml-2 font-normal text-zinc-500">game {row.game}</span>
        </p>
        <p className="text-xs text-zinc-400">
          {served} served · {won}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_120px] gap-3">
        <div>
          {url ? (
            <video
              src={url}
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-lg bg-black"
            />
          ) : (
            <button
              type="button"
              onClick={() => void load()}
              disabled={state === "loading"}
              className="flex aspect-video w-full items-center justify-center rounded-lg border border-edge bg-ink/60 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-60"
            >
              {state === "loading"
                ? "Loading"
                : state === "error"
                  ? "Clip unavailable"
                  : "Play the point"}
            </button>
          )}
          {row.serve === null && row.rejection !== null && (
            <p className="mt-2 text-xs text-amber-300/80">
              No serve drawn. {REJECTION_COPY[row.rejection]}
            </p>
          )}
        </div>
        <Court
          serve={row.serve}
          final={row.final}
          topLabel={opponent}
          bottomLabel="You"
        />
      </div>
    </div>
  );
}

export function ServeAccuracy({
  matches,
}: {
  matches: ServeAccuracyMatch[];
}) {
  const [active, setActive] = useState(matches[0].matchId);
  const [only, setOnly] = useState<"all" | "drawn" | "refused">("all");
  const match = matches.find((m) => m.matchId === active) ?? matches[0];
  const stats = useMemo(() => summarise(match.rows), [match]);
  const rows = useMemo(
    () =>
      match.rows.filter((r) =>
        only === "all"
          ? true
          : only === "drawn"
            ? r.serve !== null
            : r.serve === null,
      ),
    [match, only],
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold">Serve accuracy</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        Every point with its clip beside the dots the app draws from it. The
        filled dot is where the serve landed. The ring is the last shot of the
        rally that had a landing, drawn ungated and measured against nothing:
        it is here to be judged, not believed.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {matches.map((m) => (
          <button
            key={m.matchId}
            type="button"
            onClick={() => setActive(m.matchId)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              m.matchId === active
                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-edge bg-surface p-4">
        <p className="text-sm text-zinc-200">
          Serves drawn for {stats.drawn} of {stats.total} points. A final shot
          for {stats.withFinal}.
        </p>
        {stats.reasons.length > 0 && (
          <ul className="mt-2 space-y-1">
            {stats.reasons.map(([reason, count]) => (
              <li key={reason} className="text-xs text-zinc-500">
                <span className="tabular-nums text-zinc-400">{count}</span>
                {" · "}
                {REJECTION_COPY[reason]}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ["all", `All ${match.rows.length}`],
            ["drawn", `Serve drawn ${stats.drawn}`],
            ["refused", `Refused ${match.rows.length - stats.drawn}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setOnly(key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              only === key
                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <Row
            key={row.pointId}
            row={row}
            matchId={match.matchId}
            opponent={match.opponent}
          />
        ))}
      </div>
    </main>
  );
}
