"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Side } from "./sides";

/**
 * "Who is who?" — the owner tells us which side of the table they played
 * from, and optionally names both players. Until user_side is set, every
 * server/winner chip stays neutral ("Near player served"), so this banner
 * is the gate for "You served" wording. opponent_name is kept in sync so
 * the dashboard list shows the right name.
 */
export function PlayerTagging({
  matchId,
  firstPointId,
  userSide,
  nearName,
  farName,
  onChange,
}: {
  matchId: string;
  firstPointId: string | null;
  userSide: Side | null;
  nearName: string;
  farName: string;
  onChange: (patch: {
    userSide?: Side;
    nearName?: string;
    farName?: string;
    opponentName?: string;
  }) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = userSide === null || editOpen;

  // Show the first point's clip paused as the "which player am I?" frame.
  useEffect(() => {
    if (!editing || !firstPointId || frameUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, pointId: firstPointId }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.url && !cancelled) setFrameUrl(`${data.url}#t=0.1`);
      } catch {
        // No frame is fine; the buttons still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing, firstPointId, frameUrl, matchId]);

  const opponentFor = useCallback(
    (side: Side, near: string, far: string) =>
      (side === "near" ? far : near).trim(),
    []
  );

  const chooseSide = useCallback(
    async (side: Side) => {
      setError(null);
      const opponent = opponentFor(side, nearName, farName);
      onChange({ userSide: side, ...(opponent ? { opponentName: opponent } : {}) });
      setEditOpen(false);
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from("matches")
        .update({
          user_side: side,
          ...(opponent ? { opponent_name: opponent } : {}),
        })
        .eq("id", matchId);
      if (dbError) setError("Couldn't save. Try again.");
    },
    [matchId, nearName, farName, opponentFor, onChange]
  );

  const saveName = useCallback(
    async (side: Side, value: string) => {
      const trimmed = value.trim();
      const near = side === "near" ? trimmed : nearName;
      const far = side === "far" ? trimmed : farName;
      const opponent = userSide ? opponentFor(userSide, near, far) : "";
      onChange({
        ...(side === "near" ? { nearName: trimmed } : { farName: trimmed }),
        ...(opponent ? { opponentName: opponent } : {}),
      });
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from("matches")
        .update({
          [side === "near" ? "player_near_name" : "player_far_name"]:
            trimmed || null,
          ...(opponent ? { opponent_name: opponent } : {}),
        })
        .eq("id", matchId);
      if (dbError) setError("Couldn't save. Try again.");
    },
    [matchId, nearName, farName, userSide, opponentFor, onChange]
  );

  if (!editing) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-edge bg-surface px-4 py-3">
        <p className="text-sm text-zinc-300">
          You played from the{" "}
          <span className="font-semibold text-cyan-glow">
            {userSide === "near" ? "near" : "far"} side
          </span>
          {(nearName || farName) && (
            <span className="text-zinc-500">
              {" "}
              · Near: {nearName || "?"} · Far: {farName || "?"}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="text-sm text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-cyan-glow/30 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Who is who?</h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            Tell us which player you are so the point labels are right.
            Near is the side closest to the camera.
          </p>
        </div>
        {userSide !== null && (
          <button
            type="button"
            onClick={() => setEditOpen(false)}
            aria-label="Close player setup"
            className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,260px)_1fr]">
        {frameUrl && (
          <video
            src={frameUrl}
            muted
            playsInline
            preload="metadata"
            className="w-full rounded-xl border border-edge bg-black"
          />
        )}
        <div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void chooseSide("near")}
              aria-pressed={userSide === "near"}
              className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${
                userSide === "near"
                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
              }`}
            >
              I am on the near side
            </button>
            <button
              type="button"
              onClick={() => void chooseSide("far")}
              aria-pressed={userSide === "far"}
              className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${
                userSide === "far"
                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
              }`}
            >
              I am on the far side
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-zinc-400">
                Near player
              </span>
              <input
                defaultValue={nearName}
                onBlur={(e) => void saveName("near", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                placeholder={userSide === "near" ? "You" : "Name"}
                className="mt-1 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-400">
                Far player
              </span>
              <input
                defaultValue={farName}
                onBlur={(e) => void saveName("far", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                placeholder={userSide === "far" ? "You" : "Name"}
                className="mt-1 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
              />
            </label>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
