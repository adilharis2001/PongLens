"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BetaPill } from "@/components/BetaPill";
import { PickSide } from "@/app/match/[id]/PickSide";
import type { Side } from "@/app/match/[id]/sides";
import { createClient } from "@/lib/supabase/client";
import { youtubeThumbnail, youtubeVideoId } from "@/lib/youtube";

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
 * dashboard). Takes only the viewer's userId, used to scope the
 * remembered-venue chips to their own matches.
 */

type Phase = "idle" | "validating" | "queued" | "error";
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
  /** Commerce (098): process the moment the download lands. The worker
   *  makes the claim — there is no browser here when it finishes. */
  autoProcess: boolean;
  /** Which end the importer played from; rides on meta.user_side. */
  userSide: Side | null;
};

const DEFAULT_FORM: FormState = {
  opponent: "",
  venue: "",
  matchType: "",
  points: true,
  placement: false,
  strictness: "normal",
  autoProcess: true,
  userSide: null,
};

const STRICTNESS: { value: Strictness; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "loose", label: "Loose" },
];

const MATCH_TYPES: { value: Exclude<MatchType, "">; label: string }[] = [
  { value: "drills", label: "Drills" },
  { value: "practice", label: "Practice" },
  { value: "match", label: "Match" },
  { value: "league", label: "League" },
  { value: "tournament", label: "Tournament" },
];

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

export function YouTubeImport({
  userId,
  commerceEnabled = false,
}: {
  userId: string;
  /** 096/098: imports land in the library; processing is a paid claim. */
  commerceEnabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [canPaste, setCanPaste] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Remembered venues (distinct own matches.venue) for the one-tap chips.
  const [venues, setVenues] = useState<string[]>([]);
  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("matches")
      .select("venue")
      .eq("user_id", userId)
      .not("venue", "is", null)
      .then(({ data }) => {
        if (!data) return;
        const seen = new Set<string>();
        const list: string[] = [];
        for (const r of data as { venue: string | null }[]) {
          const v = (r.venue ?? "").trim();
          const k = v.toLowerCase();
          if (v && !seen.has(k)) {
            seen.add(k);
            list.push(v);
          }
        }
        setVenues(list.slice(0, 8));
      });
  }, [userId]);

  // Post-import form (same shape + auto-save behavior as UploadCard's
  // done state: opponent saves on blur / Enter, pills and toggles on tap).
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const formRef = useRef<FormState>(form);
  // True once the user has touched the opponent field — the AI title
  // prefill (worker-side) must never overwrite what they typed.
  const opponentDirtyRef = useRef(false);
  // Side picker: collapsed to a one-line summary until asked for, same as
  // the upload form. The still comes from the link they just pasted.
  const [sideEditing, setSideEditing] = useState(false);
  const thumbUrl = useMemo(() => youtubeThumbnail(url), [url]);
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
      points: commerceEnabled ? true : f.points,
      placement: commerceEnabled
        ? f.autoProcess && f.placement
        : f.points && f.placement,
      strictness: f.strictness,
      ...(commerceEnabled ? { auto_process: f.autoProcess } : {}),
      meta: {
        opponent_name: f.opponent.trim() || null,
        venue: f.venue.trim() || null,
        match_type: f.matchType || null,
        user_side: f.userSide,
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
          venue: next.meta.venue,
          ...(next.meta.match_type ? { match_type: next.meta.match_type } : {}),
          // The side belongs here too: without it the match page asks
          // which end they played from a second time.
          ...(next.meta.user_side ? { user_side: next.meta.user_side } : {}),
        })
        .eq("id", match.id);
    }
    setSavedFlash(true);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
  }, [commerceEnabled]);

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
    if (!youtubeVideoId(url)) {
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
        autoProcess: opts?.auto_process !== false,
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
        .select("status, progress, options, user_message")
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
      if (data.status === "failed") {
        // The card used to keep saying "We're fetching it" forever: this
        // poll read the status only to stop polling. The reason is already
        // written and already user-safe (user_message, 066); a crash has
        // none, and gets a plain line rather than the raw exception.
        done = true;
        setError(
          typeof data.user_message === "string" && data.user_message.trim()
            ? data.user_message
            : "We couldn't process this video."
        );
        setPhase("error");
        return;
      }
      const past =
        data.status === "done" ||
        (data.status === "processing" && (data.progress ?? 0) >= 10);
      if (past) setProcessingLocked(true);
      if (data.status === "done") done = true;
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
    setSideEditing(false);
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

            {/* Venue — remembered chips (tap to fill) + free text. */}
            <div>
              <input
                type="text"
                value={form.venue}
                onChange={(e) => setField("venue", e.target.value)}
                onBlur={() => void persistDetails()}
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

            {/* Which player are you? — the same question the file upload
                asks, on YouTube's own still of the video, since the file
                itself doesn't exist here until the worker fetches it.
                Skippable; the match page's first-open banner catches it. */}
            {thumbUrl && (
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
                      <p className="text-sm text-zinc-500">
                        Which player are you?
                      </p>
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
                    <p className="text-sm text-zinc-200">
                      Which player are you?
                    </p>
                    <div className="mt-3">
                      <PickSide
                        src={null}
                        posterSrc={thumbUrl}
                        selected={form.userSide}
                        onPick={(s) => {
                          setField("userSide", s, true);
                          setSideEditing(false);
                        }}
                        onSkip={() => setSideEditing(false)}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            <div
              className={`divide-y divide-edge/60 rounded-xl border border-edge bg-surface-2/40 ${
                processingLocked ? "opacity-60" : ""
              }`}
            >
              {commerceEnabled ? (
                <div className="flex items-center justify-between gap-4 p-3.5">
                  <div>
                    <p className="text-sm text-zinc-200">Process right away</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Its length in minutes comes off your balance once the
                      video is here.
                    </p>
                  </div>
                  <Toggle
                    on={form.autoProcess}
                    onChange={(v) => setField("autoProcess", v, true)}
                    disabled={processingLocked}
                    label="Process right away"
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4 p-3.5">
                  <p className="text-sm text-zinc-200">Break it into points</p>
                  <Toggle
                    on={form.points}
                    onChange={(v) => setField("points", v, true)}
                    disabled={processingLocked}
                    label="Break it into points"
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-4 p-3.5">
                <div>
                  <p
                    className={`flex items-center gap-2 text-sm ${
                      (commerceEnabled ? form.autoProcess : form.points)
                        ? "text-zinc-200"
                        : "text-zinc-500"
                    }`}
                  >
                    Placement maps
                    <BetaPill />
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Where every ball landed. Adds processing time.
                  </p>
                </div>
                <Toggle
                  on={
                    commerceEnabled
                      ? form.autoProcess && form.placement
                      : form.points && form.placement
                  }
                  onChange={(v) => setField("placement", v, true)}
                  disabled={
                    (commerceEnabled ? !form.autoProcess : !form.points) ||
                    processingLocked
                  }
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
        {/* Bordered, not filled: the file picker above is the primary
            action on this page, and a solid button down here outranked
            it. Same size and the same tap target, less weight. */}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || url.trim().length === 0}
          className="shrink-0 rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-6 py-3 text-sm font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/20 disabled:opacity-50"
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
