"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import { BetaPill } from "@/components/BetaPill";
import { chargeMinutes, formatGb, formatMinutes } from "@/lib/commerce/minutes";
import { createClient } from "@/lib/supabase/client";
import { installBackGuard, setUploading } from "@/lib/uploadGuard";
import { QUOTA_ERRORS } from "@/lib/quota";
import { PickSide } from "@/app/match/[id]/PickSide";
import type { Side } from "@/app/match/[id]/sides";
import { NameCombobox } from "./NameCombobox";

/**
 * The limit people meet is 45 MINUTES, not a byte count: minutes are what
 * gets charged, what a match is measured in, and the same rule the YouTube
 * import already applies. Bytes only decide it when the duration will not
 * parse — real footage in this library runs 2 to 15.3 Mbps, so 45 minutes
 * is anywhere between 0.6 GB and 4.8 GB and no single byte cap expresses
 * the rule. 6 GB clears the worst real case; register_upload allows 8.
 */
const MAX_DURATION_S = 45 * 60;
const MAX_BYTES = 6 * 1024 * 1024 * 1024; // backstop only
const PART_SIZE = 16 * 1024 * 1024; // 16 MiB parts: mobile-friendly, R2 min is 5 MiB
const ACCEPTED = ["video/mp4", "video/quicktime"];
const ACCEPTED_EXT = [".mp4", ".mov"];
const PENDING_KEY = "ponglens:pending-upload";
const PENDING_MAX_AGE = 6 * 24 * 3600 * 1000; // R2 aborts incomplete uploads at 7d
const PENDING_EXPIRY_MS = 7 * 24 * 3600 * 1000; // when R2 itself gives up

type Phase =
  | "idle"
  | "uploading"
  | "finishing"
  | "done"
  | "error"
  | "interrupted";
type Strictness = "tight" | "normal" | "loose";
type MatchType =
  | ""
  | "drills"
  | "practice"
  | "match"
  | "league"
  | "tournament";

type FormState = {
  opponent: string;
  venue: string;
  matchType: MatchType;
  points: boolean;
  placement: boolean;
  strictness: Strictness;
  /** Which end the uploader played from; rides on meta.user_side. */
  userSide: Side | null;
};

const DEFAULT_FORM: FormState = {
  opponent: "",
  venue: "",
  matchType: "",
  points: true,
  placement: false,
  strictness: "normal",
  userSide: null,
};

type PendingUpload = {
  bucket: string;
  key: string;
  uploadId: string;
  name: string;
  size: number;
  contentType: string;
  startedAt: number;
  form: FormState;
  /**
   * A frame from the video, and how far it got. "Pick the same video" is a
   * memory test without them: iOS shows no file names in the Photos
   * picker, so the name on its own identifies nothing, and without a
   * figure there is no way to tell whether resuming saves ten minutes or
   * nothing at all.
   */
  poster?: string | null;
  bytesUploaded?: number;
};

const STRICTNESS: { value: Strictness; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "loose", label: "Loose" },
];

/** The columns the remembered-values query reads. */
type Row = { venue: string | null; opponent_name: string | null };

const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: "drills", label: "Drills" },
  { value: "practice", label: "Practice" },
  { value: "match", label: "Match" },
  { value: "league", label: "League" },
  { value: "tournament", label: "Tournament" },
];

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** "1.4 GB", "612 MB" — the pair of numbers a waiting upload should show. */
function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  const gb = n / 1073741824;
  if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1048576))} MB`;
}

/** "about 6 minutes left" — plain words, not a stopwatch. */
function formatEta(secondsLeft: number) {
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) return null;
  if (secondsLeft < 45) return "less than a minute left";
  const mins = Math.round(secondsLeft / 60);
  if (mins < 60) return `about ${mins} minute${mins === 1 ? "" : "s"} left`;
  const hrs = Math.round(secondsLeft / 3600);
  return `about ${hrs} hour${hrs === 1 ? "" : "s"} left`;
}

/** R2 abandons an incomplete multipart at seven days; say so. */
function expiryLine(expiresAt: number) {
  const days = Math.ceil((expiresAt - Date.now()) / (24 * 3600 * 1000));
  if (days <= 0) return "This one has expired. Pick the video to start again.";
  return days === 1
    ? "You can resume it until tomorrow."
    : `You can resume it for ${days} more days.`;
}

/** "45 minutes", "1 hour 4 minutes" — for the over-the-limit message. */
function formatLength(seconds: number) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0
    ? `${h} hour${h === 1 ? "" : "s"}`
    : `${h} hour${h === 1 ? "" : "s"} ${m} minute${m === 1 ? "" : "s"}`;
}

/**
 * Read the length and grab one frame, before a single byte moves.
 *
 * Both answers are needed up front now: the length decides whether the
 * file is even allowed and quotes the minute cost while the user can
 * still change their mind, and the frame is what makes an interrupted
 * upload recognisable later. Everything here fails soft — plenty of
 * browsers will not decode an iPhone's HEVC .mov, and an upload must not
 * be blocked by a thumbnail.
 */
function probeVideo(
  url: string
): Promise<{ durationS: number | null; poster: string | null }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let settled = false;
    const done = (durationS: number | null, poster: string | null) => {
      if (settled) return;
      settled = true;
      v.removeAttribute("src");
      v.load();
      resolve({ durationS, poster });
    };
    const timer = window.setTimeout(() => done(null, null), 6000);
    const finish = (durationS: number | null, poster: string | null) => {
      window.clearTimeout(timer);
      done(durationS, poster);
    };

    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.onerror = () => finish(null, null);
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      // Seek somewhere with play in it, the way the side picker does.
      v.onseeked = () => {
        try {
          const w = v.videoWidth;
          const h = v.videoHeight;
          if (!w || !h) return finish(d, null);
          const scale = Math.min(1, 320 / w);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(d, null);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          finish(d, canvas.toDataURL("image/jpeg", 0.5));
        } catch {
          // Tainted or undecodable: the length alone is still useful.
          finish(d, null);
        }
      };
      if (d === null) return finish(null, null);
      try {
        v.currentTime = Math.max(0, Math.min(60, d * 0.5));
      } catch {
        finish(d, null);
      }
    };
    v.src = url;
  });
}

function contentTypeOf(file: File) {
  return extOf(file.name) === ".mov" || file.type === "video/quicktime"
    ? "video/quicktime"
    : "video/mp4";
}

function readPending(): PendingUpload | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as PendingUpload;
    if (!rec.key || !rec.uploadId || !rec.size) return null;
    if (Date.now() - rec.startedAt > PENDING_MAX_AGE) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

function writePending(rec: PendingUpload) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(rec));
  } catch {}
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {}
}

// @uppy/aws-s3 rate-limits signing requests but deliberately runs part PUTs
// outside its queue (priority Infinity), so a big file would otherwise fire
// every part at once and exhaust browser sockets/memory. This tiny semaphore
// caps the actual part uploads.
const PART_CONCURRENCY = 4;
let partsActive = 0;
const partWaiters: (() => void)[] = [];
async function withPartSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (partsActive >= PART_CONCURRENCY) {
    await new Promise<void>((resolve) => partWaiters.push(resolve));
  }
  partsActive++;
  try {
    return await fn();
  } finally {
    partsActive--;
    partWaiters.shift()?.();
  }
}

async function api(payload: Record<string, unknown>, signal?: AbortSignal) {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }
  return res.json();
}

function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
        on ? "border-cyan-glow/60 bg-cyan-glow/30" : "border-edge bg-surface-2"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
          on ? "left-6 bg-cyan-glow" : "left-0.5 bg-zinc-500"
        }`}
      />
    </button>
  );
}

export function UploadCard({
  userId,
  commerceEnabled = false,
  orderId = null,
}: {
  userId: string;
  // 096: uploads become library rows instead of enqueuing processing.
  commerceEnabled?: boolean;
  // An active review order (096): the upload is held outside the
  // player's storage allowance until the order completes.
  orderId?: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  // Commerce mode: the library row created at completion, and the file's
  // duration read from its metadata (the charging basis for processing).
  const [libraryMatchId, setLibraryMatchId] = useState<string | null>(null);
  const libraryMatchIdRef = useRef<string | null>(null);
  const durationRef = useRef<number | null>(null);
  // "Process right away" (096): on by default — a first upload should
  // become a match without a second decision. The claim runs after the
  // upload lands; if minutes are short the video still lands safely in
  // the library and the done panel says so. Order uploads skip this —
  // the review's own claim pays for those.
  const [autoProcess, setAutoProcess] = useState(true);
  const autoProcessRef = useRef(true);
  autoProcessRef.current = autoProcess;
  const [autoPlacement, setAutoPlacement] = useState(false);
  const autoPlacementRef = useRef(false);
  autoPlacementRef.current = autoPlacement;
  const [autoState, setAutoState] = useState<
    "started" | "short" | "manual" | null
  >(null);
  // The claim we can still take back: /api/process answers with the job
  // and what it cost, and the job is cancellable until the worker picks
  // it up. See migration 112 for why undo rather than a countdown.
  const [undo, setUndo] = useState<{ jobId: string; minutes: number } | null>(
    null
  );
  const [undoBusy, setUndoBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  // Bytes and a rate, so the wait is legible. A percentage on its own says
  // nothing about whether this is a two-minute wait or a twenty-minute one.
  const [bytes, setBytes] = useState<{ uploaded: number; total: number } | null>(
    null
  );
  const rateRef = useRef<{ t0: number; b0: number } | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  // Length of the picked file, known before the upload starts: it gates the
  // 45-minute limit and quotes the minute cost while the toggle is still
  // in reach.
  const [durationS, setDurationS] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the error panel should offer. A wrong file has nothing to retry. */
  const errorActionRef = useRef<"pick" | "retry" | "none">("retry");
  const [errorAction, setErrorAction] = useState<"pick" | "retry" | "none">(
    "retry"
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingPoster, setPendingPoster] = useState<string | null>(null);
  const [pendingPct, setPendingPct] = useState<number | null>(null);
  const [pendingExpiry, setPendingExpiry] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const inputRef = useRef<HTMLInputElement>(null);
  // Local object URL of the picked file, so the side picker can show a real
  // frame before/while the file uploads. Kept in a ref too, to revoke it on
  // reset/cancel/unmount (leaked blob URLs pin the whole video in memory).
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const localVideoUrlRef = useRef<string | null>(null);
  /** A frame from the picked file, saved with the pending record. */
  const posterRef = useRef<string | null>(null);
  const [sideEditing, setSideEditing] = useState(true);
  const revokeLocalVideo = useCallback(() => {
    if (localVideoUrlRef.current) {
      URL.revokeObjectURL(localVideoUrlRef.current);
      localVideoUrlRef.current = null;
    }
    setLocalVideoUrl(null);
  }, []);
  useEffect(() => () => revokeLocalVideo(), [revokeLocalVideo]);

  const uppyRef = useRef<Uppy | null>(null);
  const formRef = useRef<FormState>(form);
  const phaseRef = useRef<Phase>(phase);
  const uploadRef = useRef<{ bucket: string; key: string; name: string } | null>(
    null
  );
  const errorKindRef = useRef<"upload" | "queue">("upload");
  const jobIdRef = useRef<string | null>(null);
  const jobOptionsRef = useRef<Record<string, unknown> | null>(null);
  // Post-done auto-save feedback (same pattern as the point scorecard).
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Once the worker picks the job up, the processing toggles are baked.
  const [processingLocked, setProcessingLocked] = useState(false);
  const [storage, setStorage] = useState<{
    used_bytes: number;
    limit_bytes: number;
  } | null>(null);
  // The user's own past venues and opponents, shown as one-tap chips.
  // Distinct non-null values from their own matches (RLS returns coached
  // matches too, so scope to own rows), most recent first — you play the
  // same people at the same clubs, so the last few cover most uploads.
  const [venues, setVenues] = useState<string[]>([]);
  const [opponents, setOpponents] = useState<string[]>([]);
  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("matches")
      .select("venue, opponent_name, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (!data) return;
        const distinct = (pick: (r: Row) => string | null) => {
          const seen = new Set<string>();
          const list: string[] = [];
          for (const r of data as Row[]) {
            const v = (pick(r) ?? "").trim();
            const k = v.toLowerCase();
            if (v && !seen.has(k)) {
              seen.add(k);
              list.push(v);
            }
          }
          return list.slice(0, 8);
        };
        setVenues(distinct((r) => r.venue));
        setOpponents(distinct((r) => r.opponent_name));
      });
  }, [userId]);

  useEffect(() => {
    // Refresh the discreet usage line on mount and after each finished upload.
    if (phase === "uploading" || phase === "finishing") return;
    const supabase = createClient();
    void supabase
      .rpc("my_storage_state")
      .single()
      .then(({ data }) => {
        // The RPC's column is storage_limit_bytes — reading limit_bytes
        // here kept this line invisible for months.
        const d = data as {
          used_bytes?: number | string;
          storage_limit_bytes?: number | string;
        } | null;
        if (d?.storage_limit_bytes) {
          setStorage({
            used_bytes: Number(d.used_bytes ?? 0),
            limit_bytes: Number(d.storage_limit_bytes),
          });
        }
      });
  }, [phase]);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  formRef.current = form;
  phaseRef.current = phase;

  // --- Screen wake lock: keep the phone awake while uploading -------------
  const acquireWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        console.log("[ponglens] wake lock acquired");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
          console.log("[ponglens] wake lock released");
        });
      }
    } catch {
      // Unsupported or denied: uploading still works, screen may sleep.
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const active = phase === "uploading" || phase === "finishing";

  /**
   * Enter the error state, saying what the user can actually do about it.
   * "pick" for a file that was never going to work, "retry" for something
   * that might, "none" for a wall (a quota) where the only honest answer
   * is the explanation itself. Everything used to offer Retry, including
   * the daily limit, where pressing it failed in exactly the same way.
   */
  const fail = useCallback((action: "pick" | "retry" | "none") => {
    errorActionRef.current = action;
    setErrorAction(action);
    setPhase("error");
  }, []);

  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, acquireWakeLock]);

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  // Let the app nav guard in-app navigation the same way, and cover the
  // one gesture nothing else caught: browser Back / iOS swipe-back.
  useEffect(() => {
    setUploading(active);
    return () => setUploading(false);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    return installBackGuard();
  }, [active]);

  // On mount: if a previous upload never finished, offer to resume it.
  useEffect(() => {
    const rec = readPending();
    if (rec) {
      setForm(rec.form ?? DEFAULT_FORM);
      setFileName(rec.name);
      setPendingPoster(rec.poster ?? null);
      setPendingPct(
        rec.bytesUploaded && rec.size
          ? Math.min(99, Math.round((rec.bytesUploaded / rec.size) * 100))
          : null
      );
      setPendingExpiry(rec.startedAt + PENDING_EXPIRY_MS);
      setPhase("interrupted");
    }
  }, []);

  // Keep the saved form in sync so a resume restores the user's answers.
  useEffect(() => {
    if (phase !== "uploading" && phase !== "finishing") return;
    const rec = readPending();
    if (rec) writePending({ ...rec, form });
  }, [form, phase]);

  // Auto-save (post-done): write the whole form to jobs.options — the
  // worker reads the row fresh at pickup, so toggle changes inside the
  // grace window are honored. Meta also lands on the matches row if
  // processing already finished. No-op while the upload is still running
  // (the queueJob insert carries the form) and when nothing changed.
  const persistDetails = useCallback(async () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    const f = formRef.current;
    const base = jobOptionsRef.current ?? {};
    const next = {
      ...base,
      points: f.points,
      placement: f.points && f.placement,
      strictness: f.strictness,
      meta: {
        opponent_name: f.opponent.trim() || null,
        venue: f.venue.trim() || null,
        match_type: f.matchType || null,
        user_side: f.userSide,
      },
    };
    if (JSON.stringify(next) === JSON.stringify(base)) return;
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ options: next })
      .eq("id", jobId);
    if (error) {
      setSaveError("Couldn't save. Tap again.");
      return;
    }
    jobOptionsRef.current = next;
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .eq("job_id", jobId)
      .maybeSingle();
    if (match) {
      await supabase
        .from("matches")
        .update({
          opponent_name: next.meta.opponent_name,
          venue: next.meta.venue,
          ...(next.meta.match_type ? { match_type: next.meta.match_type } : {}),
        })
        .eq("id", match.id);
    }
    setSavedFlash(true);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
  }, []);

  /**
   * Commerce mode's save path: straight onto the match row.
   *
   * The old build wrote details into jobs.options, which commerce mode
   * never creates — so every edit after the upload landed went nowhere,
   * and the form was unmounted at "done" anyway. Now the form outlives the
   * upload and this is what makes that mean something. A no-op until the
   * row exists; the register call carries whatever was typed before then,
   * and reconcile() closes the gap between the two.
   */
  const persistMatchDetails = useCallback(async () => {
    const matchId = libraryMatchIdRef.current;
    if (!matchId) return;
    const f = formRef.current;
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("matches")
      .update({
        opponent_name: f.opponent.trim() || null,
        venue: f.venue.trim() || null,
        match_type: f.matchType || null,
        ...(f.userSide ? { user_side: f.userSide } : {}),
      })
      .eq("id", matchId);
    if (error) {
      setSaveError("Couldn't save. Tap again.");
      return;
    }
    setSavedFlash(true);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
  }, []);

  /** Whichever save path this mode actually has. */
  const persistAny = useCallback(() => {
    if (commerceEnabled) return persistMatchDetails();
    return persistDetails();
  }, [commerceEnabled, persistMatchDetails, persistDetails]);

  // --- Queue the processing job once the file is in R2 --------------------
  const queueJob = useCallback(async () => {
    const up = uploadRef.current;
    if (!up) return;
    setPhase("finishing");
    const f = formRef.current;
    const supabase = createClient();
    const { data: inserted, error: insertError } = await supabase.from("jobs").insert({
      user_id: userId,
      input_path: `r2://${up.bucket}/${up.key}`,
      original_name: up.name,
      kind: "deadspace_cut",
      status: "queued",
      options: {
        points: f.points,
        placement: f.points && f.placement,
        strictness: f.strictness,
        meta: {
          opponent_name: f.opponent.trim() || null,
          venue: f.venue.trim() || null,
          match_type: f.matchType || null,
          user_side: f.userSide,
        },
      },
    }).select("id, options").single();
    if (insertError) {
      errorKindRef.current = "queue";
      setError("Upload finished but we couldn't start processing.");
      fail("retry");
      return;
    }
    releaseWakeLock();
    jobIdRef.current = inserted?.id ?? null;
    jobOptionsRef.current = inserted?.options ?? null;
    setPhase("done");
    window.dispatchEvent(new CustomEvent("ponglens:job-created"));
    // If the user edited the form while the insert was in flight, the
    // insert carried a stale snapshot — sync it now.
    if (formRef.current !== f) void persistDetails();
  }, [userId, releaseWakeLock, persistDetails, fail]);

  // While the done header shows, poll the job (lightweight, like the match
  // view's clip poll): the moment status leaves 'queued' the worker has the
  // options, so the processing toggles lock. Opponent/type stay editable.
  useEffect(() => {
    if (phase !== "done" || processingLocked) return;
    const jobId = jobIdRef.current;
    if (!jobId) return;
    const supabase = createClient();
    let stopped = false;
    const check = async () => {
      const { data } = await supabase
        .from("jobs")
        .select("status")
        .eq("id", jobId)
        .maybeSingle();
      if (!stopped && data && data.status !== "queued") {
        setProcessingLocked(true);
      }
    };
    void check();
    const iv = window.setInterval(() => void check(), 8000);
    return () => {
      stopped = true;
      window.clearInterval(iv);
    };
  }, [phase, processingLocked]);

  // --- Build a headless Uppy wired to our presign routes ------------------
  const buildUppy = useCallback(
    (file: File, resume: PendingUpload | null) => {
      uppyRef.current?.destroy();
      const contentType = contentTypeOf(file);
      const uppy = new Uppy({ autoProceed: false });

      uppy.use(AwsS3, {
        // 4 parts in flight keeps memory + connection use sane on phones.
        limit: 4,
        uploadPartBytes: (opts) => withPartSlot(() => AwsS3.uploadPartBytes(opts)),
        shouldUseMultipart: true,
        getChunkSize: () => PART_SIZE,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        createMultipartUpload: async () => {
          const res = (await api({
            action: "create",
            fileSize: file.size,
            contentType,
            ...(commerceEnabled && orderId ? { orderId } : {}),
          })) as { bucket: string; key: string; uploadId: string };
          uploadRef.current = {
            bucket: res.bucket,
            key: res.key,
            name: file.name,
          };
          writePending({
            bucket: res.bucket,
            key: res.key,
            uploadId: res.uploadId,
            name: file.name,
            size: file.size,
            contentType,
            startedAt: Date.now(),
            form: formRef.current,
            poster: posterRef.current,
            bytesUploaded: 0,
          });
          return { uploadId: res.uploadId, key: res.key };
        },
        signPart: async (_f, { key, uploadId, partNumber, signal }) => {
          const res = await api(
            { action: "sign-part", key, uploadId, partNumber },
            signal ?? undefined
          );
          return { url: res.url as string };
        },
        listParts: async (_f, { key, uploadId, signal }) => {
          const res = await api(
            { action: "list-parts", key, uploadId },
            signal ?? undefined
          );
          console.log(
            `[ponglens] resume: ${res.parts.length} part(s) already in R2, skipping them`
          );
          return res.parts;
        },
        completeMultipartUpload: async (_f, { key, uploadId, parts }) => {
          if (commerceEnabled) {
            // The upload becomes a library row right here; the form's
            // latest values ride along (formRef is current at call time).
            const f = formRef.current;
            const res = await api({
              action: "complete",
              key,
              uploadId,
              parts,
              register: {
                durationS: durationRef.current,
                originalName: file.name,
                // On a camera-roll export this is when the clip was shot,
                // which is what the library should sort and title by. The
                // upload time is a fact about the network.
                capturedAtMs: file.lastModified || null,
                opponent: f.opponent.trim() || null,
                venue: f.venue.trim() || null,
                matchType: f.matchType || null,
                userSide: f.userSide,
                orderId,
              },
            });
            if (typeof res.matchId === "string") {
              setLibraryMatchId(res.matchId);
              libraryMatchIdRef.current = res.matchId;
            }
            return {};
          }
          await api({ action: "complete", key, uploadId, parts });
          return {};
        },
        abortMultipartUpload: async (_f, { key, uploadId }) => {
          await api({ action: "abort", key, uploadId });
        },
      });

      uppy.on("progress", (pct) => {
        setProgress(Math.min(100, Math.round(pct)));
      });
      // Bytes and an estimate. Also the only place that knows how far a
      // resumable upload actually got, so the pending record learns it
      // here — throttled to whole percents, since this fires constantly.
      let lastPersistedPct = -1;
      uppy.on("upload-progress", (_f, p) => {
        const uploaded = p?.bytesUploaded ?? 0;
        const total = p?.bytesTotal || file.size;
        if (!total) return;
        setBytes({ uploaded, total });
        const now = Date.now();
        if (!rateRef.current) rateRef.current = { t0: now, b0: uploaded };
        const { t0, b0 } = rateRef.current;
        const elapsed = (now - t0) / 1000;
        const moved = uploaded - b0;
        // Wait for a few seconds of real transfer before guessing; an
        // estimate from the first packet is a wild number on screen.
        if (elapsed > 4 && moved > 0) {
          setEta(formatEta(((total - uploaded) / (moved / elapsed)) | 0));
        }
        const pct = Math.floor((uploaded / total) * 100);
        if (pct !== lastPersistedPct) {
          lastPersistedPct = pct;
          const rec = readPending();
          if (rec) writePending({ ...rec, bytesUploaded: uploaded });
        }
      });
      uppy.on("upload-success", () => {
        clearPending();
        if (commerceEnabled) {
          releaseWakeLock();
          setPhase("done");
          window.dispatchEvent(new CustomEvent("ponglens:job-created"));
          const matchId = libraryMatchIdRef.current;
          // Anything typed or tapped between the completion payload going
          // out and the row id coming back was written to a match that did
          // not exist yet. Now that it does, put the form on it.
          if (matchId) void persistMatchDetails();
          // Process right away, when asked and when this is a personal
          // upload. The claim does every check (balance, queue, double
          // taps); a refusal leaves the video safe in the library.
          if (autoProcessRef.current && !orderId && matchId) {
            void fetch("/api/process", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                matchId,
                placement: autoPlacementRef.current,
              }),
            })
              .then(async (res) => {
                const data = await res.json().catch(() => null);
                if (res.ok) {
                  setAutoState("started");
                  // Keep the claim reversible while it is only queued.
                  if (typeof data?.job_id === "string") {
                    setUndo({
                      jobId: data.job_id,
                      minutes: Number(data.charged_minutes) || 0,
                    });
                  }
                  window.dispatchEvent(
                    new CustomEvent("ponglens:job-created")
                  );
                  return;
                }
                setAutoState(
                  data?.code === "insufficient_minutes" ? "short" : "manual",
                );
              })
              .catch(() => setAutoState("manual"));
          } else {
            setAutoState("manual");
          }
          return;
        }
        void queueJob();
      });
      uppy.on("upload-error", (_file, err) => {
        errorKindRef.current = "upload";
        // Quota/limit rejections from /api/upload-url carry an exact,
        // user-facing message — show it as-is. A quota wall is not
        // retryable: offering Retry there just fails again in the same
        // way, which is the whole of what the old error panel did.
        const msg = err?.message ?? "";
        const quota = Object.values(QUOTA_ERRORS).find((q) => msg.includes(q));
        setError(
          quota ??
            (/network|fetch|load/i.test(msg)
              ? "The connection dropped."
              : "The upload hit a snag.")
        );
        fail(quota ? "none" : "retry");
      });

      const id = uppy.addFile({
        name: file.name,
        type: contentType,
        data: file,
      });

      if (resume) {
        uploadRef.current = {
          bucket: resume.bucket,
          key: resume.key,
          name: resume.name,
        };
        // Seeding s3Multipart makes @uppy/aws-s3 restore the upload:
        // it calls listParts and skips parts that are already in R2.
        uppy.setFileState(id, {
          s3Multipart: { key: resume.key, uploadId: resume.uploadId },
        } as unknown as Parameters<Uppy["setFileState"]>[1]);
      }

      uppyRef.current = uppy;
      return uppy;
    },
    [queueJob, commerceEnabled, orderId, releaseWakeLock, persistMatchDetails, fail]
  );

  // --- Start (or resume) the moment a file is picked ----------------------
  const beginUpload = useCallback(
    async (file: File) => {
      setError(null);
      const okType =
        ACCEPTED.includes(file.type) || ACCEPTED_EXT.includes(extOf(file.name));
      if (!okType) {
        errorKindRef.current = "upload";
        setError("That's not an MP4 or MOV video.");
        fail("pick");
        return;
      }
      if (file.size > MAX_BYTES) {
        errorKindRef.current = "upload";
        setError(
          "That file is over 6 GB. Trim it on your phone first, or upload it in two halves."
        );
        fail("pick");
        return;
      }

      let resume = readPending();
      if (resume && (resume.name !== file.name || resume.size !== file.size)) {
        // Different file: drop the old unfinished upload and start fresh.
        void api({
          action: "abort",
          key: resume.key,
          uploadId: resume.uploadId,
        }).catch(() => {});
        clearPending();
        resume = null;
      }
      if (resume) setForm(resume.form ?? DEFAULT_FORM);

      setFileName(file.name);
      setProgress(0);
      setBytes(null);
      setEta(null);
      rateRef.current = null;
      // A local preview for the "which player are you?" picker (revoked on
      // reset/cancel/unmount). MOV may not play in every browser; the
      // picker says so and the match page asks again.
      revokeLocalVideo();
      const objUrl = URL.createObjectURL(file);
      localVideoUrlRef.current = objUrl;
      setLocalVideoUrl(objUrl);

      // Read the length BEFORE any bytes move. It decides whether the file
      // is allowed at all, and it is what lets the card quote the minute
      // cost while the toggle above the drop zone is still in reach. The
      // probe also hands back a frame for the resume card. A file whose
      // metadata will not parse just proceeds: the byte cap is the backstop
      // and the raw match page can still read the duration from its player.
      setPreparing(true);
      const probed = await probeVideo(objUrl);
      setPreparing(false);
      durationRef.current = probed.durationS;
      setDurationS(probed.durationS);
      posterRef.current = probed.poster;
      if (probed.durationS != null && probed.durationS > MAX_DURATION_S) {
        errorKindRef.current = "upload";
        setError(
          `That video is ${formatLength(probed.durationS)}. The limit is 45 minutes, so trim it first or upload it in two halves.`
        );
        revokeLocalVideo();
        fail("pick");
        return;
      }

      setSideEditing(true);
      setPhase("uploading");
      void acquireWakeLock();

      const uppy = buildUppy(file, resume);
      uppy.upload().catch(() => {
        // Errors surface through the upload-error handler.
      });
    },
    [acquireWakeLock, buildUppy, revokeLocalVideo, fail]
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (files && files.length > 0) void beginUpload(files[0]);
    },
    [beginUpload]
  );

  const cancelUpload = useCallback(() => {
    uppyRef.current?.cancelAll();
    uppyRef.current?.destroy();
    uppyRef.current = null;
    clearPending();
    releaseWakeLock();
    revokeLocalVideo();
    setPhase("idle");
    setProgress(0);
    setBytes(null);
    setEta(null);
    rateRef.current = null;
    setDurationS(null);
    durationRef.current = null;
    posterRef.current = null;
    setFileName(null);
    setForm(DEFAULT_FORM);
    formRef.current = DEFAULT_FORM;
  }, [releaseWakeLock, revokeLocalVideo]);

  const discardInterrupted = useCallback(() => {
    const rec = readPending();
    if (rec) {
      void api({ action: "abort", key: rec.key, uploadId: rec.uploadId }).catch(
        () => {}
      );
    }
    clearPending();
    setPhase("idle");
    setFileName(null);
    setForm(DEFAULT_FORM);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    if (errorKindRef.current === "queue") {
      void queueJob();
      return;
    }
    if (uppyRef.current) {
      setPhase("uploading");
      void acquireWakeLock();
      uppyRef.current.retryAll().catch(() => {});
    } else if (readPending()) {
      setPhase("interrupted");
    } else {
      setPhase("idle");
    }
  }, [queueJob, acquireWakeLock]);

  /** Take back a processing claim the worker has not started yet. */
  const undoProcessing = useCallback(async () => {
    if (!undo || undoBusy) return;
    setUndoBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_queued_processing", {
      p_job_id: undo.jobId,
    });
    setUndoBusy(false);
    if (error) {
      // Almost always because the worker just picked it up, which is the
      // one case where there is nothing left to give back.
      setSaveError("Too late to undo. This one has started processing.");
      setUndo(null);
      return;
    }
    setUndo(null);
    setAutoState("manual");
    window.dispatchEvent(new CustomEvent("ponglens:job-created"));
  }, [undo, undoBusy]);

  // The undo offer only stands while the job is queued. Poll alongside the
  // existing lock poll and drop the button the moment the worker starts.
  useEffect(() => {
    if (!undo) return;
    const supabase = createClient();
    let stopped = false;
    const check = async () => {
      const { data } = await supabase
        .from("jobs")
        .select("status")
        .eq("id", undo.jobId)
        .maybeSingle();
      if (!stopped && data && data.status !== "queued") setUndo(null);
    };
    const iv = window.setInterval(() => void check(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(iv);
    };
  }, [undo]);

  const reset = useCallback(() => {
    uppyRef.current?.destroy();
    uppyRef.current = null;
    uploadRef.current = null;
    jobIdRef.current = null;
    jobOptionsRef.current = null;
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    setSavedFlash(false);
    setSaveError(null);
    setProcessingLocked(false);
    revokeLocalVideo();
    setSideEditing(true);
    setPhase("idle");
    setProgress(0);
    setBytes(null);
    setEta(null);
    rateRef.current = null;
    setFileName(null);
    setError(null);
    setLibraryMatchId(null);
    libraryMatchIdRef.current = null;
    setAutoState(null);
    setUndo(null);
    setDurationS(null);
    durationRef.current = null;
    posterRef.current = null;
    setForm(DEFAULT_FORM);
    formRef.current = DEFAULT_FORM;
  }, [revokeLocalVideo]);

  // Field setter. `save` auto-saves tap-style fields (pills, toggles)
  // immediately once a job exists; the opponent text input saves on
  // blur / Enter instead, like the match view's name field. formRef is
  // synced here (not just at render) so an immediate persist sees the
  // new value.
  const setField = useCallback(
    <K extends keyof FormState>(k: K, v: FormState[K], save = false) => {
      const next = { ...formRef.current, [k]: v };
      formRef.current = next;
      setForm(next);
      if (save) void persistAny();
    },
    [persistAny]
  );

  // Answering after the upload has landed still has to reach the row —
  // the register call is long gone by then. Answering DURING the upload
  // rides in formRef into that call instead, and reconcile() covers the
  // seconds in between, when the payload has been sent but the row id has
  // not come back: that window used to swallow the answer while the card
  // collapsed and said it had been saved.
  const persistSide = async (side: Side) => {
    const matchId = libraryMatchIdRef.current;
    if (!matchId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("matches")
      .update({ user_side: side })
      .eq("id", matchId);
    if (error) setSaveError("Couldn't save. Tap again.");
  };

  {/* Which player are you? — a real frame from the picked file, so
      labels and maps come out oriented. Skippable; first-open on the
      match page catches it if skipped. */}
  const sideCard = localVideoUrl ? (
    <div className="rounded-xl border border-edge bg-surface-2/40 p-3.5">
      {!sideEditing ? (
        <div className="flex items-center justify-between gap-3">
          {form.userSide !== null ? (
            <p className="text-sm text-zinc-200">
              You&apos;re at the{" "}
              <span className="font-semibold text-cyan-glow">
                {form.userSide === "near" ? "bottom" : "top"}
              </span>{" "}
              of the video
            </p>
          ) : (
            <p className="text-sm text-zinc-500">Which player are you?</p>
          )}
          <button
            type="button"
            onClick={() => setSideEditing(true)}
            className="shrink-0 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
          >
            {form.userSide !== null ? "Change" : "Set"}
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-200">Which player are you?</p>
          <div className="mt-3">
            <PickSide
              src={localVideoUrl}
              atSeconds={60}
              selected={form.userSide}
              onPick={(s) => {
                setField("userSide", s, true);
                void persistSide(s);
                setSideEditing(false);
              }}
              onSkip={() => setSideEditing(false)}
            />
          </div>
        </>
      )}
    </div>
  ) : null;

  const quote = durationS != null ? chargeMinutes(durationS) : null;

  {/* The processing decision, ABOVE the drop zone and visible from the
      moment the page loads. It used to live inside the picked-file branch,
      which meant it only appeared once the upload was already running and
      vanished again when it finished — so on any quick upload the minutes
      were spent by a toggle nobody ever saw. Consent has to come before
      the bytes, not after them. */}
  const processOptions =
    commerceEnabled && !orderId && phase !== "done" ? (
      <div className="mt-6 divide-y divide-edge/60 rounded-xl border border-edge bg-surface-2/40">
        <div className="flex items-center justify-between gap-4 p-3.5">
          <div className="min-w-0">
            <p className="text-sm text-zinc-200">
              Process when the upload finishes
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {quote != null
                ? `Uses ${formatMinutes(quote)} of your balance.`
                : "Its length in minutes comes off your balance."}
            </p>
          </div>
          <Toggle
            on={autoProcess}
            onChange={setAutoProcess}
            label="Process when the upload finishes"
          />
        </div>
        <div className="flex items-center justify-between gap-4 p-3.5">
          <div className="min-w-0">
            <p
              className={`flex items-center gap-2 text-sm ${autoProcess ? "text-zinc-200" : "text-zinc-500"}`}
            >
              Placement maps
              <BetaPill />
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Where every ball landed. Adds processing time.
            </p>
          </div>
          <Toggle
            on={autoProcess && autoPlacement}
            onChange={setAutoPlacement}
            disabled={!autoProcess}
            label="Placement maps"
          />
        </div>
      </div>
    ) : null;

  return (
    <section className="rounded-2xl border border-edge bg-surface p-5 sm:p-8">
      <h2 className="text-lg font-semibold">Upload a match</h2>
      <p className="mt-1 text-sm text-zinc-400">
        MP4 or MOV, up to 45 minutes.
      </p>

      {(phase === "idle" || active) && processOptions}

      {active || phase === "done" ? (
        <div className="mt-6">
          {/* Header strip — the only part that transitions. Percent + bar
              while uploading, the done message after. */}
          <div>
            {phase === "done" ? (
              commerceEnabled ? (
                <>
                  <p className="text-center text-sm font-medium text-emerald-400">
                    {autoState === "started"
                      ? "Uploaded. Processing has started."
                      : autoState === "short"
                        ? "Uploaded, but processing needs more minutes than you have."
                        : "Uploaded. It's in your library."}
                  </p>
                  <p className="mt-1 text-center text-xs text-zinc-500">
                    {autoState === "started"
                      ? undo && undo.minutes > 0
                        ? `${formatMinutes(undo.minutes)} used. You'll get an email when it's ready.`
                        : "You'll get an email when it's ready."
                      : autoState === "short"
                        ? "Open the video to trim it, or get more minutes in Account."
                        : "Open it to watch, or process it into points."}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-center text-sm font-medium text-emerald-400">
                    Done. Processing starts now.
                  </p>
                  <p className="mt-1 text-center text-xs text-zinc-500">
                    You&apos;ll get an email when it&apos;s ready.
                  </p>
                </>
              )
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-4xl font-semibold tabular-nums text-zinc-100">
                    {progress}
                    <span className="text-xl text-zinc-500">%</span>
                  </p>
                  <p className="shrink-0 text-sm text-zinc-400">
                    {phase === "finishing" ? "Finishing up" : "Uploading"}
                  </p>
                </div>
                <div
                  role="progressbar"
                  aria-label="Upload progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  className="mt-3 h-1 overflow-hidden rounded-full bg-ink"
                >
                  <div
                    className="h-full rounded-full bg-cyan-glow transition-[width] duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {/* Bytes and an estimate: on a phone a percentage alone
                    does not say whether to wait or put the phone down. */}
                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-zinc-500">
                  <span className="min-w-0 truncate">{fileName}</span>
                  {bytes && (
                    <span className="shrink-0 tabular-nums">
                      {formatBytes(bytes.uploaded)} of{" "}
                      {formatBytes(bytes.total)}
                      {eta ? ` · ${eta}` : ""}
                    </span>
                  )}
                </div>
                {/* The one instruction that saves an upload: iOS suspends
                    a backgrounded tab and the transfer stalls. */}
                <p className="mt-2 text-xs text-zinc-400">
                  Keep this screen open until it finishes.
                </p>
              </>
            )}
          </div>

          {/* One continuous form, mounted from file-pick through post-done.
              During the upload edits ride into the job insert; after it
              they auto-save. Processing toggles lock at worker pickup. */}
          <div className="mt-6 space-y-4">
            {/* The form outlives the upload. It used to be torn down the
                moment the file landed, so on a fast connection nobody ever
                reached it: every match came out with a null opponent, a
                null venue and a title of "Match". Now it stays, and each
                field writes straight to the match row. */}
            <>
            {/* Opponent — free text with a list of the people you have
                played, filtering as you type. NOT chips like the venue
                below: a club list is a handful, an opponent list is every
                person you have ever recorded, and a few hundred chips is a
                wall rather than a shortcut. */}
            <NameCombobox
              value={form.opponent}
              options={opponents}
              onChange={(v) => setField("opponent", v)}
              onCommit={() => void persistAny()}
              placeholder="Opponent name"
              ariaLabel="Opponent name"
              className="w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
            />

            {/* Venue — remembered chips (tap to fill) + free text. */}
            <div>
              <input
                type="text"
                value={form.venue}
                onChange={(e) => setField("venue", e.target.value)}
                onBlur={() => void persistAny()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="Club or location"
                aria-label="Venue"
                autoComplete="off"
                enterKeyHint="done"
                className="w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
              />
              {venues.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {venues.map((v) => {
                    const on = form.venue.trim() === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setField("venue", on ? "" : v, true)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          on
                            ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                            : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {MATCH_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={form.matchType === t.value}
                  onClick={() =>
                    setField(
                      "matchType",
                      form.matchType === t.value ? "" : t.value,
                      true
                    )
                  }
                  className={`rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                    form.matchType === t.value
                      ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {sideCard}

            {!commerceEnabled && (
            <div
              className={`divide-y divide-edge/60 rounded-xl border border-edge bg-surface-2/40 ${
                processingLocked ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-4 p-3.5">
                <p className="text-sm text-zinc-200">Break it into points</p>
                <Toggle
                  on={form.points}
                  onChange={(v) => setField("points", v, true)}
                  disabled={processingLocked}
                  label="Break it into points"
                />
              </div>
              <div className="flex items-center justify-between gap-4 p-3.5">
                <div>
                  <p
                    className={`flex items-center gap-2 text-sm ${form.points ? "text-zinc-200" : "text-zinc-500"}`}
                  >
                    Placement maps
                    <BetaPill />
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Adds processing time
                  </p>
                </div>
                <Toggle
                  on={form.points && form.placement}
                  onChange={(v) => setField("placement", v, true)}
                  disabled={!form.points || processingLocked}
                  label="Placement maps"
                />
              </div>
              <div className="p-3.5">
                <p className="text-sm text-zinc-200">Cut strictness</p>
                <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg border border-edge bg-ink/60 p-1">
                  {STRICTNESS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      aria-pressed={form.strictness === s.value}
                      disabled={processingLocked}
                      onClick={() => setField("strictness", s.value, true)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        form.strictness === s.value
                          ? "bg-cyan-glow/15 text-cyan-glow"
                          : "text-zinc-400 hover:text-zinc-200"
                      } ${processingLocked ? "cursor-not-allowed" : ""}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            )}

            {/* Auto-save feedback; fixed height so nothing shifts. */}
            <p aria-live="polite" className="min-h-5 text-center text-xs">
              {saveError ? (
                <span className="text-red-300">{saveError}</span>
              ) : savedFlash ? (
                <span className="text-emerald-400">Saved</span>
              ) : null}
            </p>
            </>

            {phase === "done" ? (
              /* One row for every "what now". The undo used to sit up in
                 the status block, a whole form away from these two, and
                 nobody scans two places for the same kind of choice. It is
                 in the middle because it is the one with a deadline: the
                 eye lands there between two stable neighbours. The row
                 simply reflows when the offer expires — a reserved gap for
                 a button that is usually gone reads worse than a shrink. */
              <div className="flex flex-wrap items-center justify-center gap-3 text-center">
                {commerceEnabled && libraryMatchId && (
                  <a
                    href={`/match/${libraryMatchId}`}
                    className="glow-cta rounded-full bg-cyan-glow px-6 py-3 text-sm font-semibold text-ink"
                  >
                    Open the video
                  </a>
                )}
                {undo && (
                  <button
                    type="button"
                    onClick={() => void undoProcessing()}
                    disabled={undoBusy}
                    className="rounded-full border border-edge px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50"
                  >
                    {undoBusy ? "Undoing…" : "Undo, don't process yet"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-full border border-edge px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                >
                  Upload another
                </button>
              </div>
            ) : (
              <div className="text-center">
                <button
                  type="button"
                  onClick={cancelUpload}
                  className="rounded-full border border-edge px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-amber-400/60 hover:text-amber-200"
                >
                  Cancel upload
                </button>
              </div>
            )}
          </div>
        </div>
      ) : phase === "interrupted" ? (
        /* Resume. The frame is the point: iOS shows no file names in the
           Photos picker, so a name alone identifies nothing, and the
           percentage is what tells you whether resuming is worth it. */
        <div className="mt-6 rounded-2xl border border-edge bg-surface-2/40 p-6 text-center">
          {pendingPoster && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={pendingPoster}
              alt=""
              className="mx-auto mb-4 aspect-video w-full max-w-xs rounded-xl border border-edge object-contain"
            />
          )}
          <p className="text-sm text-zinc-200">
            {pendingPct != null && pendingPct > 0
              ? `This video is ${pendingPct}% uploaded. Pick it again to carry on.`
              : "Upload interrupted. Pick the same video to continue."}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-500">{fileName}</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="glow-cta mt-4 rounded-full bg-cyan-glow px-6 py-3 text-sm font-semibold text-ink"
          >
            Pick video
          </button>
          {pendingExpiry != null && (
            <p className="mt-3 text-xs text-zinc-500">
              {expiryLine(pendingExpiry)}
            </p>
          )}
          <div className="mt-3">
            <button
              type="button"
              onClick={discardInterrupted}
              className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-400 transition-colors hover:border-amber-400/60 hover:text-amber-200"
            >
              Upload a different video
            </button>
          </div>
        </div>
      ) : phase === "error" ? (
        /* The action follows the error. A file that is the wrong type or
           too long has nothing to retry; a quota wall has nothing at all,
           and the old panel's single Retry button just failed again. */
        <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm text-red-300">{error}</p>
          {errorAction !== "none" && (
            <button
              type="button"
              onClick={
                errorAction === "pick"
                  ? () => {
                      setError(null);
                      setPhase("idle");
                      inputRef.current?.click();
                    }
                  : retry
              }
              className="mt-4 rounded-full border border-edge bg-surface px-6 py-2.5 text-sm font-semibold text-zinc-100 transition-colors hover:border-cyan-glow/50"
            >
              {errorAction === "pick" ? "Choose a different video" : "Retry"}
            </button>
          )}
          {errorAction === "none" && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPhase("idle");
                }}
                className="rounded-full border border-edge bg-surface px-5 py-2.5 text-sm text-zinc-200 transition-colors hover:border-cyan-glow/50"
              >
                Close
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
          className={`mt-6 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? "border-cyan-glow bg-cyan-glow/5"
              : "border-edge bg-surface-2/40"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="mx-auto h-10 w-10 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16V4m0 0-4 4m4-4 4 4M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"
            />
          </svg>
          {/* The primary action of the whole product. It was a 20px
              underlined phrase inside a sentence, which is not a tap
              target on a phone and read as less important than the
              YouTube importer's filled button further down the page. */}
          <button
            type="button"
            disabled={preparing}
            onClick={() => inputRef.current?.click()}
            className="glow-cta mt-4 rounded-full bg-cyan-glow px-6 py-3 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {preparing ? "Reading the video…" : "Choose a video"}
          </button>
          {/* Desktop only: there is nothing to drag from on a phone. */}
          <p className="mt-3 hidden text-xs text-zinc-500 sm:block">
            or drag one here
          </p>
        </div>
      )}

      {/* The storage line lives on the balances card below, which is on
          this same page. Two readings of one number could only ever
          disagree, and they did: /1e9 here said 11 GB while the card's
          formatGb said 10. Kept only where the card is absent. */}
      {storage && !commerceEnabled && (
        <p className="mt-4 text-center text-xs text-zinc-600">
          <span
            className={
              storage.used_bytes >= storage.limit_bytes ? "text-red-400" : ""
            }
          >
            {formatGb(storage.used_bytes)} of {formatGb(storage.limit_bytes)}{" "}
            used
          </span>
          {storage.used_bytes >= storage.limit_bytes && (
            <>
              {" · "}
              <a href="/account" className="underline underline-offset-2">
                add space
              </a>
            </>
          )}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </section>
  );
}
