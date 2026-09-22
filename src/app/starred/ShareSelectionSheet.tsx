"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BottomSheet, SHEET_PRIMARY_BUTTON } from "@/components/BottomSheet";
import { ShareQR } from "@/components/ShareQR";
import { Switch } from "@/components/Switch";
import { ProcessingAvailabilityNoticeContent } from "@/components/ProcessingAvailabilityNotice";
import { createClient } from "@/lib/supabase/client";
import { triggerDownload } from "@/lib/download";
import { availabilityNotice, serviceLane } from "@/lib/processingAvailability";
import { useProcessingService } from "@/lib/useProcessingService";
import {
  SELECTION_LINK_MAX_POINTS,
  SELECTION_VIDEO_MAX_POINTS,
} from "@/lib/starredSelection";
import type { StarredPointRow } from "./starred";

/**
 * Sharing starred points picked from any number of matches (2026-09-22).
 * The web twin of the phone's ShareSelectionSheet, minus Instagram, which
 * only the phone can hand a video to:
 *
 *   Save the video   one vertical video of these points, rendered by the
 *                    worker (the same file the phone posts as a Reel)
 *   Share a link     a public link that plays these points, through the
 *                    same title step as the match Share sheet
 *
 * The three switches say what the video's frame carries. They are
 * remembered on this browser, like the phone remembers them.
 */

const POLL_MS = 1200;
const DEADLINE_MS = 5 * 60 * 1000;

const rowClass =
  "flex w-full items-center gap-3 rounded-xl border border-edge bg-ink/40 p-3.5 text-left transition-colors hover:border-cyan-glow/40 disabled:opacity-60";

function useStoredSwitch(key: string): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setOn(stored !== "false");
    } catch {
      // private mode or blocked storage: the default stands
    }
  }, [key]);
  const set = useCallback(
    (v: boolean) => {
      setOn(v);
      try {
        window.localStorage.setItem(key, String(v));
      } catch {
        // not remembered, still applied
      }
    },
    [key],
  );
  return [on, set];
}

function Icon({ d }: { d: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </span>
  );
}

export function ShareSelectionSheet({
  open,
  onClose,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  /** The picked points, in shelf order. */
  rows: StarredPointRow[];
}) {
  const services = useProcessingService();
  const [showNames, setShowNames] = useStoredSwitch("shareShowNames");
  const [showScore, setShowScore] = useStoredSwitch("shareShowScore");
  const [showLogo, setShowLogo] = useStoredSwitch("shareShowLogo");

  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("Starred points");
  const [linkBusy, setLinkBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [videoBusy, setVideoBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  useEffect(() => {
    if (!open) return;
    run.current += 1;
    setNaming(false);
    setTitle("Starred points");
    setLinkBusy(false);
    setLink(null);
    setCopied(false);
    setVideoBusy(false);
    setProgress(null);
    setError(null);
  }, [open]);

  const pointIds = rows.map((r) => r.id);
  const n = rows.length;
  const tooManyForVideo = n > SELECTION_VIDEO_MAX_POINTS;
  const tooManyForLink = n > SELECTION_LINK_MAX_POINTS;
  const noun = `${n} point${n === 1 ? "" : "s"}`;
  const notice = availabilityNotice(
    services[serviceLane("reel", services.clip_lane, "v:selection")],
    "fast",
  );

  const saveVideo = useCallback(async () => {
    if (videoBusy) return;
    const mine = ++run.current;
    setVideoBusy(true);
    setError(null);
    setProgress("This takes a little while.");
    try {
      const res = await fetch("/api/reel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pointIds,
          purpose: "save",
          showNames,
          showScore,
          showLogo,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" && data.error.includes(" ")
            ? data.error
            : "Couldn't prepare the video. Try again.",
        );
      }
      if (data?.status !== "ready") {
        // Queued on the worker: watch the one row this account has.
        const supabase = createClient();
        const started = Date.now();
        for (;;) {
          if (run.current !== mine) return;
          if (Date.now() - started > DEADLINE_MS) {
            throw new Error("That took too long. Try again in a minute.");
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
          const { data: row } = await supabase
            .from("selection_reels")
            .select("status")
            .maybeSingle();
          if (row?.status === "ready") break;
          if (row?.status === "failed") {
            throw new Error("Couldn't prepare the video. Try again.");
          }
          if (row?.status === "rendering") setProgress("Almost there.");
        }
      }
      if (run.current !== mine) return;
      const signed = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectionReel: true }),
      });
      const signedData = signed.ok ? await signed.json() : null;
      if (!signedData?.url) throw new Error("Couldn't prepare the video. Try again.");
      triggerDownload(signedData.url);
      setProgress(null);
    } catch (e) {
      if (run.current !== mine) return;
      setProgress(null);
      setError(e instanceof Error ? e.message : "Couldn't prepare the video. Try again.");
    } finally {
      if (run.current === mine) setVideoBusy(false);
    }
  }, [pointIds, showLogo, showNames, showScore, videoBusy]);

  const shareLink = useCallback(async () => {
    if (linkBusy) return;
    setLinkBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pointIds, title: title.trim().slice(0, 80) }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      setLink(data.url);
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ url: data.url });
        } catch {
          // dismissed the OS sheet; the link stays visible below
        }
      } else {
        await navigator.clipboard.writeText(data.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      setError("Couldn't create the link. Try again.");
    } finally {
      setLinkBusy(false);
    }
  }, [linkBusy, pointIds, title]);

  const copyLink = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Select the link and copy it manually.");
    }
  }, [link]);

  if (!open) return null;

  return (
    <BottomSheet
      open
      portal
      title={`Share ${noun}`}
      onClose={onClose}
      closeLabel="Close share sheet"
      leading={
        naming && (
          <button
            type="button"
            onClick={() => {
              setNaming(false);
              setLink(null);
            }}
            aria-label="Back"
            className="-ml-1 mt-0.5 rounded-full p-1 text-zinc-400 transition-colors hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        )
      }
    >
      {naming ? (
        <div className="mt-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void shareLink();
            }}
            maxLength={80}
            autoComplete="off"
            enterKeyHint="go"
            aria-label="Link title"
            placeholder="Starred points"
            className="w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
          />
          <p className="px-1 text-xs text-zinc-500">
            Anyone with the link can watch. Revoke it anytime from your account.
          </p>
          <button
            type="button"
            disabled={linkBusy}
            onClick={() => void shareLink()}
            className={SHEET_PRIMARY_BUTTON}
          >
            {linkBusy ? "Creating link…" : copied ? "Copied" : "Share"}
          </button>
          {link && (
            <>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-zinc-300">
                  {link}
                </p>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="shrink-0 rounded-full border border-edge bg-surface-2 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <ShareQR url={link} />
            </>
          )}
        </div>
      ) : (
        <>
          {notice && (
            <ProcessingAvailabilityNoticeContent notice={notice} className="mt-4" />
          )}
          <div className="mt-4 space-y-2">
            <button
              type="button"
              disabled={videoBusy || tooManyForVideo}
              onClick={() => void saveVideo()}
              className={rowClass}
            >
              <Icon d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-100">
                  {videoBusy ? "Preparing…" : "Save the video"}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {tooManyForVideo
                    ? `A video takes up to ${SELECTION_VIDEO_MAX_POINTS} points.`
                    : (progress ?? "These points as one vertical video, to save or send anywhere.")}
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={videoBusy || tooManyForLink}
              onClick={() => {
                setError(null);
                setNaming(true);
              }}
              className={rowClass}
            >
              <Icon d="M9 15l6-6m-4-1 1-1a3.5 3.5 0 1 1 5 5l-1 1m-6 6-1 1a3.5 3.5 0 1 1-5-5l1-1" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-100">
                  Share a link
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {tooManyForLink
                    ? `A link takes up to ${SELECTION_LINK_MAX_POINTS} points.`
                    : "Anyone with the link can watch these points."}
                </span>
              </span>
            </button>
          </div>

          <div className="mt-4 divide-y divide-edge/60 rounded-xl border border-edge bg-ink/40">
            {(
              [
                ["Include names", showNames, setShowNames],
                ["Include score", showScore, setShowScore],
                ["Include logo", showLogo, setShowLogo],
              ] as const
            ).map(([label, on, set]) => (
              <div key={label} className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5">
                <span className="text-sm text-zinc-200">{label}</span>
                <Switch on={on} onChange={set} label={label} />
              </div>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </BottomSheet>
  );
}
