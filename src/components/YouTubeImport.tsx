"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * YouTubeImport — paste a public or unlisted YouTube link instead of
 * uploading a file. POSTs to /api/import-url, which queues a
 * 'youtube_import' job; the Mac worker fetches the video and runs the
 * same pipeline as a direct upload.
 *
 * Pre-submit it is just the link field. After Import, ONE form — the same
 * structure and behavior as the upload card's — collects opponent, match
 * type AND the processing options (points / placement / strictness), all
 * auto-saving into jobs.options with the Saved flash. The worker re-reads
 * the row after the yt-dlp download finishes, so processing edits made
 * while the video downloads are honored; the toggles lock when the worker
 * passes that point (status poll: 'processing' with progress >= 10).
 * Opponent / match type stay editable throughout.
 *
 * Mount this next to the upload surface (e.g. on /upload or the
 * dashboard). It is self-contained: no props required.
 */

type Phase = "idle" | "validating" | "queued" | "error";
type Strictness = "tight" | "normal" | "loose";
type MatchType = "" | "practice" | "league" | "tournament";

type FormState = {
  opponent: string;
  matchType: MatchType;
  points: boolean;
  placement: boolean;
  strictness: Strictness;
};

const DEFAULT_FORM: FormState = {
  opponent: "",
  matchType: "",
  points: true,
  placement: false,
  strictness: "normal",
};

const STRICTNESS: { value: Strictness; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "loose", label: "Loose" },
];

const MATCH_TYPES: { value: Exclude<MatchType, "">; label: string }[] = [
  { value: "practice", label: "Practice" },
  { value: "league", label: "League" },
  { value: "tournament", label: "Tournament" },
];

// Mirrors the server-side check in /api/import-url (the server re-validates).
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function looksLikeYouTube(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    try {
      url = new URL(`https://${raw.trim()}`);
    } catch {
      return false;
    }
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    return VIDEO_ID.test(url.pathname.split("/")[1] ?? "");
  }
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  ) {
    if (url.pathname === "/watch") {
      return VIDEO_ID.test(url.searchParams.get("v") ?? "");
    }
    const m = url.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/);
    return !!m && VIDEO_ID.test(m[2]);
  }
  return false;
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

export function YouTubeImport() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [canPaste, setCanPaste] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Post-import form (same shape + auto-save behavior as UploadCard's
  // done state: opponent saves on blur / Enter, pills and toggles on tap).
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const formRef = useRef<FormState>(form);
  // True once the user has touched the opponent field — the AI title
  // prefill (worker-side) must never overwrite what they typed.
  const opponentDirtyRef = useRef(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Locks when the worker passes its post-download options re-read
  // (status 'processing' with progress >= 10, or a terminal status).
  const [processingLocked, setProcessingLocked] = useState(false);
  const jobIdRef = useRef<string | null>(null);
  const jobOptionsRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    // Clipboard read needs a secure context and browser support; only
    // then does the Paste affordance make sense.
    setCanPaste(typeof navigator.clipboard?.readText === "function");
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setUrl(text.trim());
        setPhase((p) => (p === "error" ? "idle" : p));
        setError(null);
      }
    } catch {
      // Permission denied or empty clipboard: just hand focus over.
    }
    inputRef.current?.focus();
  }, []);

  // Same write path as UploadCard.persistDetails, with one extra guard:
  // a youtube_import job's options.url (and any other worker-owned keys)
  // must never be clobbered, so the merge base is refetched from the row
  // whenever we don't hold it. No-op when nothing changed.
  const persistDetails = useCallback(async () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    const f = formRef.current;
    const supabase = createClient();
    let base = jobOptionsRef.current;
    if (!base) {
      const { data } = await supabase
        .from("jobs")
        .select("options")
        .eq("id", jobId)
        .maybeSingle();
      base = (data?.options as Record<string, unknown>) ?? null;
    }
    const next = {
      ...(base ?? {}),
      points: f.points,
      placement: f.points && f.placement,
      strictness: f.strictness,
      meta: {
        opponent_name: f.opponent.trim() || null,
        match_type: f.matchType || null,
      },
    };
    if (JSON.stringify(next) === JSON.stringify(base)) return;
    setSaveError(null);
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
          ...(next.meta.match_type ? { match_type: next.meta.match_type } : {}),
        })
        .eq("id", match.id);
    }
    setSavedFlash(true);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
  }, []);

  // Field setter, UploadCard-style: pills and toggles auto-save on tap,
  // the opponent input saves on blur / Enter. formRef is synced here (not
  // just at render) so an immediate persist sees the new value.
  const setField = useCallback(
    <K extends keyof FormState>(k: K, v: FormState[K], save = false) => {
      const next = { ...formRef.current, [k]: v };
      formRef.current = next;
      setForm(next);
      if (save) void persistDetails();
    },
    [persistDetails]
  );

  const submit = useCallback(async () => {
    setError(null);
    if (!looksLikeYouTube(url)) {
      setError("That doesn't look like a YouTube video link.");
      setPhase("error");
      return;
    }
    setPhase("validating");
    try {
      const res = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Couldn't queue the import. Try again.");
      }
      jobIdRef.current = body?.jobId ?? null;
      const opts = (body?.options as Record<string, unknown> | null) ?? null;
      jobOptionsRef.current = opts;
      const fresh: FormState = {
        ...DEFAULT_FORM,
        points: opts?.points !== false,
        placement: opts?.placement === true,
        strictness:
          opts?.strictness === "tight" || opts?.strictness === "loose"
            ? opts.strictness
            : "normal",
      };
      formRef.current = fresh;
      setForm(fresh);
      opponentDirtyRef.current = false;
      setSavedFlash(false);
      setSaveError(null);
      setProcessingLocked(false);
      setPhase("queued");
      window.dispatchEvent(new CustomEvent("ponglens:job-created"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't queue the import.");
      setPhase("error");
    }
  }, [url]);

  // While the queued screen shows, poll the job (8s, like UploadCard).
  // The processing toggles stay editable through the 60s enqueue grace AND
  // the yt-dlp download — the worker re-reads jobs.options only after the
  // download — so lock at the true cutoff: the worker stamps progress=10
  // right before that re-read. Refreshing the merge base from the row also
  // picks up the worker's AI opponent prefill (shown only if the user
  // hasn't typed a name). Opponent/type stay editable forever.
  useEffect(() => {
    if (phase !== "queued") return;
    const jobId = jobIdRef.current;
    if (!jobId) return;
    const supabase = createClient();
    let stopped = false;
    let done = false;
    const check = async () => {
      if (done) return;
      const { data } = await supabase
        .from("jobs")
        .select("status, progress, options")
        .eq("id", jobId)
        .maybeSingle();
      if (stopped || !data) return;
      const opts = (data.options as Record<string, unknown> | null) ?? null;
      if (opts) {
        jobOptionsRef.current = opts;
        const meta = (opts.meta ?? {}) as Record<string, unknown>;
        const prefilled =
          typeof meta.opponent_name === "string" ? meta.opponent_name : "";
        if (
          prefilled &&
          !opponentDirtyRef.current &&
          formRef.current.opponent === ""
        ) {
          const next = { ...formRef.current, opponent: prefilled };
          formRef.current = next;
          setForm(next);
        }
      }
      const past =
        data.status === "done" ||
        data.status === "failed" ||
        (data.status === "processing" && (data.progress ?? 0) >= 10);
      if (past) setProcessingLocked(true);
      if (data.status === "done" || data.status === "failed") done = true;
    };
    void check();
    const iv = window.setInterval(() => void check(), 8000);
    return () => {
      stopped = true;
      window.clearInterval(iv);
    };
  }, [phase]);

  const reset = useCallback(() => {
    setPhase("idle");
    setUrl("");
    setError(null);
    formRef.current = DEFAULT_FORM;
    setForm(DEFAULT_FORM);
    opponentDirtyRef.current = false;
    setSavedFlash(false);
    setSaveError(null);
    setProcessingLocked(false);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    jobIdRef.current = null;
    jobOptionsRef.current = null;
  }, []);

  if (phase === "queued") {
    return (
      <section className="rounded-2xl border border-edge bg-surface p-5 sm:p-8">
        <h2 className="text-lg font-semibold">Import from YouTube</h2>
        <div className="mt-6">
          <p className="text-center text-sm font-medium text-emerald-400">
            We&apos;re fetching it. You can leave this page.
          </p>
          <p className="mt-1 text-center text-xs text-zinc-500">
            You&apos;ll get an email when your match is ready.
          </p>

          {/* One form, identical in structure and behavior to the upload
              card's: everything auto-saves. Processing toggles lock once
              the worker passes its post-download options re-read. */}
          <div className="mt-6 space-y-4">
            <input
              type="text"
              value={form.opponent}
              onChange={(e) => {
                opponentDirtyRef.current = true;
                setField("opponent", e.target.value);
              }}
              onBlur={() => void persistDetails()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder="Opponent name"
              autoComplete="off"
              enterKeyHint="done"
              className="w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
            />

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
                    className={`text-sm ${form.points ? "text-zinc-200" : "text-zinc-500"}`}
                  >
                    Placement maps
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

            {/* Auto-save feedback; fixed height so nothing shifts. */}
            <p aria-live="polite" className="min-h-5 text-center text-xs">
              {saveError ? (
                <span className="text-red-300">{saveError}</span>
              ) : savedFlash ? (
                <span className="text-emerald-400">Saved</span>
              ) : null}
            </p>

            <div className="text-center">
              <button
                type="button"
                onClick={reset}
                className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
              >
                Import another
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const busy = phase === "validating";

  return (
    <section className="rounded-2xl border border-edge bg-surface p-5 sm:p-8">
      <h2 className="text-lg font-semibold">Import from YouTube</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Public or unlisted videos, up to 45 minutes. It must be your footage
        or footage you have the rights to.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative w-full flex-1">
          <input
            ref={inputRef}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (phase === "error") {
                setPhase("idle");
                setError(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void submit();
            }}
            placeholder="Paste a YouTube link"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className={`w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none disabled:opacity-60 ${
              canPaste ? "pr-20" : ""
            }`}
          />
          {canPaste ? (
            <button
              type="button"
              onClick={() => void pasteFromClipboard()}
              disabled={busy}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-edge bg-surface px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50"
            >
              Paste
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || url.trim().length === 0}
          className="glow-cta shrink-0 rounded-full bg-cyan-glow px-6 py-3 text-sm font-semibold text-ink transition-opacity disabled:opacity-50"
        >
          {busy ? "Checking…" : "Import"}
        </button>
      </div>

      {phase === "error" && error ? (
        <p className="mt-3 text-sm text-red-300">{error}</p>
      ) : null}
    </section>
  );
}
