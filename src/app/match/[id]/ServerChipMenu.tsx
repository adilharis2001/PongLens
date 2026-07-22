"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";
import { CHIP_TONE, serverChip, type Side } from "./sides";
import {
  otherServer,
  rotationChip,
  type MatchServer,
  type ServeInfo,
} from "./serving";

/**
 * The server chip, tappable by the owner. Tapping opens a small menu:
 *   - "You/They served (override)" — sets points.server_override. Under the
 *     rotation model the override is also the anchor for later points.
 *   - "Rotation is off from here" — same write, spelled out for the case
 *     where the whole rotation drifted: the fix re-anchors everything after.
 *   - "Mark as let" — same server serves again; excluded from score and
 *     rotation count.
 * Coaches see a plain, read-only chip.
 */
export function ServerChipMenu({
  point,
  serve,
  userSide,
  isOwner,
  onPointUpdate,
}: {
  point: Point;
  serve: ServeInfo | undefined;
  userSide: Side | null;
  isOwner: boolean;
  onPointUpdate: (pointId: string, patch: Partial<Point>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const computed = serve?.server ?? null;
  const chip = computed
    ? rotationChip(computed, isOwner)
    : point.server
      ? serverChip(point.server, userSide, isOwner)
      : null;

  const save = useCallback(
    async (patch: Partial<Pick<Point, "server_override" | "is_let">>) => {
      if (busy) return;
      setBusy(true);
      setOpen(false);
      const prev = {
        server_override: point.server_override,
        is_let: point.is_let,
      };
      onPointUpdate(point.id, patch);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update(patch)
        .eq("id", point.id);
      setBusy(false);
      if (error) onPointUpdate(point.id, prev);
    },
    [busy, point.id, point.server_override, point.is_let, onPointUpdate]
  );

  const letTag = point.is_let ? (
    <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
      Let
    </span>
  ) : null;

  if (!isOwner) {
    return (
      <>
        {chip && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${CHIP_TONE[chip.tone]}`}
          >
            {chip.label}
          </span>
        )}
        {letTag}
      </>
    );
  }

  const flip: MatchServer | null = computed ? otherServer(computed) : null;
  const overrideItems: { label: string; value: MatchServer }[] = flip
    ? [{ label: flip === "user" ? "You served" : "They served", value: flip }]
    : [
        { label: "You served", value: "user" },
        { label: "They served", value: "opponent" },
      ];

  return (
    <span className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        disabled={busy}
        aria-expanded={open}
        aria-label={chip ? `${chip.label}. Fix server` : "Set the server"}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-opacity disabled:opacity-60 ${
          chip ? CHIP_TONE[chip.tone] : CHIP_TONE.neutral
        }`}
      >
        {chip ? chip.label : "Server?"}
        <svg
          viewBox="0 0 24 24"
          className="h-2.5 w-2.5 opacity-70"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {letTag}
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-edge bg-surface p-1 shadow-xl">
            {overrideItems.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void save({ server_override: item.value });
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-ink/60"
              >
                {item.label}
                <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                  Override this point
                </span>
              </button>
            ))}
            {flip && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void save({ server_override: flip });
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-ink/60"
              >
                Rotation is off from here
                <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                  Flip this point and re-anchor the rest
                </span>
              </button>
            )}
            {point.server_override && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void save({ server_override: null });
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-ink/60"
              >
                Clear override
                <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                  Back to the rotation
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void save({ is_let: !point.is_let });
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-ink/60"
            >
              {point.is_let ? "Not a let" : "Mark as let"}
              <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                {point.is_let
                  ? "Count it in the score again"
                  : "Replay: same server, not scored"}
              </span>
            </button>
          </div>
        </>
      )}
    </span>
  );
}
