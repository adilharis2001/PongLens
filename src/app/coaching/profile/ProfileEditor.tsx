"use client";

import { useEffect, useRef, useState } from "react";

import { UpLink } from "@/components/UpLink";
import type { CoachProfileRow, CoachSample } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/client";
import { AutoTextarea } from "@/components/AutoTextarea";

/**
 * Everything the storefront shows, editable in one place. The text fields
 * save whole-form on the button (they change rarely); the photo and the
 * play links persist immediately on each change, because each one is its
 * own small complete action.
 */

const FIELD =
  "mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 " +
  "text-sm text-zinc-100 outline-none focus:border-cyan-glow/50";
const LABEL =
  "mt-5 block text-xs font-semibold uppercase tracking-wider text-zinc-500";

function PhotoBlock({
  userId,
  onUrlChange,
}: {
  userId: string;
  /** Keeps the live preview's portrait in step with this block. */
  onUrlChange?: (url: string | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void fetch("/api/coach-photo")
      .then((r) => r.json())
      .then((d: { url?: string | null }) => {
        setUrl(d.url ?? null);
        onUrlChange?.(d.url ?? null);
      })
      .catch(() => {});
  }, [onUrlChange]);

  async function upload(file: File) {
    setBusy(true);
    setNote(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/coach-photo", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as {
        photo_path?: string;
        error?: string;
      };
      if (!res.ok || !data.photo_path) {
        setNote(data.error ?? "Could not upload. Try again.");
        return;
      }
      await createClient()
        .from("coach_profiles")
        .update({ photo_path: data.photo_path })
        .eq("user_id", userId);
      const fresh = await fetch("/api/coach-photo").then((r) => r.json());
      const freshUrl = (fresh as { url?: string | null }).url ?? null;
      setUrl(freshUrl);
      onUrlChange?.(freshUrl);
    } catch {
      setNote("Could not upload. Try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="h-16 w-16 rounded-full border border-edge object-cover"
        />
      ) : (
        <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-edge bg-surface-2 text-zinc-600">
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="3.5" />
            <path strokeLinecap="round" d="M5 20c1-3 3.7-4.5 7-4.5s6 1.5 7 4.5" />
          </svg>
        </span>
      )}
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-full border border-edge bg-surface-2 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 disabled:opacity-60"
        >
          {busy ? "Uploading" : url ? "Replace photo" : "Add a photo"}
        </button>
        {note && <p className="mt-2 text-xs text-amber-400">{note}</p>}
      </div>
    </div>
  );
}

interface OwnMatch {
  id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string | null;
}

function matchLabel(m: OwnMatch): string {
  const parts: string[] = [];
  if (m.opponent_name) parts.push(`vs ${m.opponent_name}`);
  if (m.played_at) {
    parts.push(
      new Date(m.played_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
  }
  return parts.join(" · ") || "Match";
}

function SamplesBlock({
  userId,
  initial,
  onSamplesChange,
}: {
  userId: string;
  initial: CoachSample[];
  /** Keeps the live preview's play links in step with this block. */
  onSamplesChange?: (samples: CoachSample[]) => void;
}) {
  const [samples, setSamples] = useState<CoachSample[]>(initial);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [picking, setPicking] = useState(false);
  const [matches, setMatches] = useState<OwnMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function persist(next: CoachSample[]) {
    setSamples(next);
    onSamplesChange?.(next);
    await createClient()
      .from("coach_profiles")
      .update({ samples: next, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  function addUrl() {
    const clean = url.trim();
    if (!/^https?:\/\/.+/.test(clean)) {
      setNote("Links start with http or https.");
      return;
    }
    setNote(null);
    void persist([
      ...samples,
      { label: label.trim().slice(0, 60) || "Watch", url: clean },
    ]);
    setLabel("");
    setUrl("");
  }

  async function openPicker() {
    setPicking(!picking);
    if (matches === null) {
      const { data } = await createClient()
        .from("matches")
        .select("id, opponent_name, venue, played_at")
        .eq("user_id", userId)
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(20);
      setMatches((data ?? []) as OwnMatch[]);
    }
  }

  async function addMatch(m: OwnMatch) {
    setBusy(true);
    setNote(null);
    try {
      // The share machinery already exists for exactly this: mint (or
      // reuse) the public link for the coach's own match.
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId: m.id }),
      });
      const data = (await res.json()) as { url?: string };
      if (!res.ok || !data.url) {
        setNote("Could not create the link. Try again.");
        return;
      }
      if (!samples.some((s) => s.url === data.url)) {
        await persist([...samples, { label: matchLabel(m), url: data.url }]);
      }
      setPicking(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Your play
      </h2>
      <p className="mt-2 text-sm text-zinc-500">
        Students trust a coach they can watch. Link a match or any video.
      </p>

      {samples.length > 0 && (
        <ul className="mt-4 space-y-2">
          {samples.map((s) => (
            <li
              key={s.url}
              className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface-2 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 truncate text-zinc-200">{s.label}</span>
              <button
                type="button"
                onClick={() =>
                  void persist(samples.filter((x) => x.url !== s.url))
                }
                className="shrink-0 text-xs text-zinc-500 hover:text-amber-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void openPicker()}
          className="rounded-full border border-edge bg-surface-2 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40"
        >
          {picking ? "Close" : "One of your matches"}
        </button>
        <span className="text-xs text-zinc-600">or paste any video link</span>
      </div>

      {picking && (
        <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
          {matches === null && (
            <p className="text-xs text-zinc-500">Loading your matches…</p>
          )}
          {matches?.length === 0 && (
            <p className="text-xs text-zinc-500">No ready matches yet.</p>
          )}
          {matches?.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={busy}
              onClick={() => void addMatch(m)}
              className="block w-full rounded-xl border border-edge bg-surface-2/60 px-4 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:border-cyan-glow/40 disabled:opacity-60"
            >
              {matchLabel(m)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="Label"
          className="w-full rounded-xl border border-edge bg-surface-2 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50 sm:w-40"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          inputMode="url"
          autoCapitalize="none"
          className="min-w-0 flex-1 rounded-xl border border-edge bg-surface-2 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
        />
        <button
          type="button"
          onClick={addUrl}
          disabled={!url.trim()}
          className="shrink-0 rounded-full border border-edge px-5 py-2.5 text-xs font-medium text-zinc-300 hover:border-cyan-glow/40 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-amber-400">{note}</p>}
    </div>
  );
}

/**
 * The storefront's identity block, rendered live from the form state so
 * the coach sees their page take shape as they type.
 */
function StorefrontPreview({
  name,
  headline,
  bio,
  credentials,
  photoUrl,
  samples,
}: {
  name: string;
  headline: string;
  bio: string;
  credentials: string;
  photoUrl: string | null;
  samples: CoachSample[];
}) {
  const creds = credentials
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 8);
  const initial = (name.trim() || "?").slice(0, 1).toUpperCase();

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        What students see
      </h2>
      <div className="rounded-2xl border border-edge bg-surface p-6">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt=""
            className="h-24 w-24 rounded-full border border-edge object-cover"
          />
        ) : (
          <span className="flex h-24 w-24 items-center justify-center rounded-full border border-edge bg-surface-2 text-3xl font-semibold text-zinc-200">
            {initial}
          </span>
        )}
        <p className="mt-4 text-xl font-bold tracking-tight text-zinc-100">
          {name.trim() || "Your name"}
        </p>
        {headline.trim() && (
          <p className="mt-1 text-sm text-zinc-400">{headline}</p>
        )}
        {creds.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {creds.map((c) => (
              <li
                key={c}
                className="rounded-full border border-edge bg-surface-2 px-3 py-1 text-xs text-zinc-300"
              >
                {c}
              </li>
            ))}
          </ul>
        )}
        {bio.trim() && (
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
            {bio}
          </p>
        )}
        {samples.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {samples.map((s) => (
              <span
                key={s.url}
                className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface-2 px-3.5 py-1.5 text-xs text-zinc-200"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3 text-cyan-glow"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileEditor({ profile }: { profile: CoachProfileRow }) {
  const [name, setName] = useState(profile.display_name);
  const [headline, setHeadline] = useState(profile.headline);
  const [bio, setBio] = useState(profile.bio);
  const [credentials, setCredentials] = useState(
    profile.credentials.join("\n"),
  );
  const [published, setPublished] = useState(profile.published);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [samples, setSamples] = useState<CoachSample[]>(profile.samples ?? []);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(nextPublished = published) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: saveError } = await supabase
      .from("coach_profiles")
      .update({
        display_name: name.trim().slice(0, 80),
        headline: headline.trim().slice(0, 120),
        bio: bio.trim().slice(0, 2000),
        credentials: credentials
          .split("\n")
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 8),
        published: nextPublished,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", profile.user_id);
    setBusy(false);
    if (saveError) {
      setError("Could not save. Try again.");
      return;
    }
    setPublished(nextPublished);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="mx-auto max-w-lg lg:max-w-none lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-x-10">
      <div className="lg:col-span-2">
        <UpLink href="/coaching" label="Coaching" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          Your page
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          ponglens.com/coach/{profile.handle} ·{" "}
          <a
            href={`/coach/${profile.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-cyan-glow"
          >
            view it
          </a>
        </p>
      </div>

      <div>
      <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
        <PhotoBlock userId={profile.user_id} onUrlChange={setPhotoUrl} />

        <label className={LABEL}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className={FIELD}
        />

        <label className={LABEL}>Headline</label>
        <AutoTextarea
          value={headline}
          onChange={(e) => setHeadline(e.target.value.replace(/\n/g, ""))}
          rows={1}
          maxLength={120}
          className={FIELD}
          placeholder="Club coach, former national team"
        />

        <label className={LABEL}>Credentials</label>
        <AutoTextarea
          value={credentials}
          onChange={(e) => setCredentials(e.target.value)}
          rows={3}
          className={FIELD}
          placeholder={"One per line\nLevel 2 certified\n20 years coaching"}
        />

        <label className={LABEL}>About you</label>
        <AutoTextarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={6}
          maxLength={2000}
          className={FIELD}
          placeholder="How you coach and who you work with."
        />

        {error && <p className="mt-3 text-xs text-amber-400">{error}</p>}

        <button
          type="button"
          onClick={() => save()}
          disabled={busy}
          className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? "Saving" : saved ? "Saved" : "Save"}
        </button>
      </div>

      <SamplesBlock
        userId={profile.user_id}
        initial={profile.samples ?? []}
        onSamplesChange={setSamples}
      />

      <div className="mt-6 flex items-center justify-between rounded-2xl border border-edge bg-surface px-5 py-4">
        <div>
          <p className="text-sm font-medium text-zinc-200">
            {published ? "Your page is live" : "Your page is hidden"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {published
              ? "Anyone with the link can see it."
              : "Publish it when your offerings are ready."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => save(!published)}
          disabled={busy}
          className={
            published
              ? "rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-surface-2"
              : "glow-cta rounded-full bg-cyan-glow px-4 py-2 text-xs font-semibold text-ink"
          }
        >
          {published ? "Hide" : "Publish"}
        </button>
      </div>
      </div>

      <div className="hidden lg:sticky lg:top-20 lg:mt-6 lg:block lg:self-start">
        <StorefrontPreview
          name={name}
          headline={headline}
          bio={bio}
          credentials={credentials}
          photoUrl={photoUrl}
          samples={samples}
        />
      </div>
    </div>
  );
}
