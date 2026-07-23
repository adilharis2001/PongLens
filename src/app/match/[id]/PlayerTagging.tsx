"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Side } from "./sides";

/**
 * "Who is who?" — ONE question: which side of the table the owner played
 * from. Names are never typed here; they're derived — the owner's side gets
 * the account first name (Google auth), the other side gets opponent_name
 * (upload form / YouTube title) — and shown read-only. Until user_side is
 * set, every server/winner chip stays neutral ("Near player served"), so
 * this banner is the gate for "You served" wording. opponent_name is kept
 * in sync so the dashboard list shows the right name.
 *
 * The buttons reference the video, not abstract near/far wording (which
 * users misread): "near" is the end closest to the camera, which is always
 * the LOWER, larger end in the frame (the worker picks the near end as the
 * larger apparent end line in calibration), so we ask "top or bottom of
 * the video" while still storing near/far.
 */
export function PlayerTagging({
  matchId,
  firstPointId,
  userSide,
  nearName,
  farName,
  accountName,
  opponentName,
  onChange,
}: {
  matchId: string;
  firstPointId: string | null;
  userSide: Side | null;
  nearName: string;
  farName: string;
  /** The owner's account first name (Google auth), or null. */
  accountName: string | null;
  /** Current opponent_name — fills the OTHER side's name on side pick. */
  opponentName: string;
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

  // Choosing a side fills whatever names are still missing — the chosen
  // side from the account name, the other side from opponent_name — and
  // saves everything in ONE write. Existing names are never overwritten.
  const chooseSide = useCallback(
    async (side: Side) => {
      setError(null);
      const account = (accountName ?? "").trim();
      const opp = opponentName.trim();
      let near = nearName.trim();
      let far = farName.trim();
      if (side === "near") {
        near = near || account;
        far = far || opp;
      } else {
        far = far || account;
        near = near || opp;
      }
      const opponent = (side === "near" ? far : near).trim();
      onChange({
        userSide: side,
        nearName: near,
        farName: far,
        ...(opponent ? { opponentName: opponent } : {}),
      });
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from("matches")
        .update({
          user_side: side,
          player_near_name: near || null,
          player_far_name: far || null,
          ...(opponent ? { opponent_name: opponent } : {}),
        })
        .eq("id", matchId);
      if (dbError) setError("Couldn't save. Try again.");
    },
    [matchId, nearName, farName, accountName, opponentName, onChange]
  );

  if (!editing) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-edge bg-surface px-4 py-3">
        <p className="text-sm text-zinc-300">
          You are the player at the{" "}
          <span className="font-semibold text-cyan-glow">
            {userSide === "near" ? "bottom" : "top"} of the video
          </span>
          {(nearName || farName) && (
            <span className="text-zinc-500">
              {" "}
              · Bottom: {nearName || "?"} · Top: {farName || "?"}
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
          <h2 className="text-base font-semibold">Which player are you?</h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            Tell us which side you played from, so the point labels and the
            placement map are right.
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
          {(nearName.trim() || farName.trim()) && (
            <p className="mb-3 text-sm text-zinc-400">
              Bottom:{" "}
              <span className="font-medium text-zinc-200">
                {nearName.trim() || "?"}
              </span>{" "}
              · Top:{" "}
              <span className="font-medium text-zinc-200">
                {farName.trim() || "?"}
              </span>
            </p>
          )}
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
              I am the player at the bottom of the video
              <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                Closer to the camera
              </span>
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
              I am the player at the top of the video
              <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                Farther from the camera
              </span>
            </button>
          </div>

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          {userSide && (
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="glow-cta mt-4 rounded-full bg-cyan-glow px-6 py-2 text-sm font-semibold text-ink"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
