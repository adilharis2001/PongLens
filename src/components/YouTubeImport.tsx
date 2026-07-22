"use client";

import { useCallback, useState } from "react";

/**
 * YouTubeImport — paste a public or unlisted YouTube link instead of
 * uploading a file. POSTs to /api/import-url, which queues a
 * 'youtube_import' job; the Mac worker fetches the video and runs the
 * same pipeline as a direct upload.
 *
 * Options mirror the upload sheet's jobs.options shape exactly
 * (points / placement / strictness + meta.opponent_name / meta.match_type)
 * so the worker treats both paths identically.
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

const MATCH_TYPES: { value: MatchType; label: string }[] = [
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
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [showOptions, setShowOptions] = useState(false);

  const setField = useCallback(
    <K extends keyof FormState>(k: K, v: FormState[K]) => {
      setForm((f) => ({ ...f, [k]: v }));
    },
    []
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
        body: JSON.stringify({
          url,
          points: form.points,
          placement: form.points && form.placement,
          strictness: form.strictness,
          meta: {
            opponent_name: form.opponent.trim() || null,
            match_type: form.matchType || null,
          },
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Couldn't queue the import. Try again.");
      }
      setPhase("queued");
      window.dispatchEvent(new CustomEvent("ponglens:job-created"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't queue the import.");
      setPhase("error");
    }
  }, [url, form]);

  const reset = useCallback(() => {
    setPhase("idle");
    setUrl("");
    setError(null);
    setForm(DEFAULT_FORM);
    setShowOptions(false);
  }, []);

  if (phase === "queued") {
    return (
      <section className="rounded-2xl border border-edge bg-surface p-5 sm:p-8">
        <h2 className="text-lg font-semibold">Import from YouTube</h2>
        <div className="mt-6 rounded-2xl border border-edge bg-surface-2/40 p-6 text-center">
          <p className="text-sm font-medium text-emerald-400">
            We&apos;re fetching it. You can leave this page.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            You&apos;ll get an email when your match is ready.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-4 rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            Import another
          </button>
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
        <input
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
          className="w-full flex-1 rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none disabled:opacity-60"
        />
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

      <button
        type="button"
        onClick={() => setShowOptions((v) => !v)}
        className="mt-4 text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
      >
        {showOptions ? "Hide options" : "Options"}
      </button>

      {showOptions ? (
        <div className="mt-4 space-y-4">
          <input
            type="text"
            value={form.opponent}
            onChange={(e) => setField("opponent", e.target.value)}
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
                    form.matchType === t.value ? "" : t.value
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

          <div className="divide-y divide-edge/60 rounded-xl border border-edge bg-surface-2/40">
            <div className="flex items-center justify-between gap-4 p-3.5">
              <p className="text-sm text-zinc-200">Break it into points</p>
              <Toggle
                on={form.points}
                onChange={(v) => setField("points", v)}
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
                onChange={(v) => setField("placement", v)}
                disabled={!form.points}
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
                    onClick={() => setField("strictness", s.value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      form.strictness === s.value
                        ? "bg-cyan-glow/15 text-cyan-glow"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
