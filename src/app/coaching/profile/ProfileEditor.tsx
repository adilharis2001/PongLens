"use client";

import { useEffect, useRef, useState } from "react";

import { BriefField } from "@/components/BriefField";
import { UpLink } from "@/components/UpLink";
import type {
  CoachProfileRow,
  CoachSample,
  CoachSection,
} from "@/lib/reviews/types";
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

const DRAFT_ERRORS: Record<string, string> = {
  too_short: "Tell me a little more and I can make a better start.",
  too_many: "That is enough drafting for now. Try again in an hour.",
  not_a_coach: "Set up your coach page first.",
  unavailable: "Drafting is not available right now.",
};

interface DraftedProfile {
  headline: string;
  credentials: string[];
  bio: string;
  sections: CoachSection[];
}

/**
 * One answer, and the page fills itself in.
 *
 * Folded away until asked for, because a coach who has already written
 * their page does not want a writing tool shouting at them every visit.
 * It fills the fields and stops; their own Save button is still the only
 * thing that writes anything.
 */
function ProfileDrafter({
  onDrafted,
}: {
  onDrafted: (d: DraftedProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    if (busy || brief.trim().length < 15) return;
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/profile/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: brief.trim() }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | (DraftedProfile & { code?: string })
      | null;
    setBusy(false);
    if (!res?.ok || !data || (!data.headline && !data.bio)) {
      setNote(
        DRAFT_ERRORS[data?.code ?? ""] ?? "Could not write it. Try again.",
      );
      return;
    }
    onDrafted(data);
    setOpen(false);
    setBrief("");
  }

  // Opening it from halfway down a long form leaves the box straddling the
  // fold, so bring the whole thing into view.
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-cyan-glow/40 px-5 py-2.5 text-sm font-medium text-cyan-glow transition-colors hover:bg-cyan-glow/10"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 2.5 13.6 8 19 9.5 13.6 11 12 16.5 10.4 11 5 9.5 10.4 8 12 2.5Z" />
          <path d="M18.5 14.5 19.3 17l2.2.8-2.2.8-.8 2.4-.8-2.4-2.2-.8 2.2-.8.8-2.5Z" />
        </svg>
        Write it for me
      </button>
    );
  }

  return (
    <div
      ref={box}
      className="mt-5 rounded-2xl border border-cyan-glow/40 bg-surface-2/40 p-4"
    >
      <p className="text-sm font-semibold text-zinc-100">
        Tell me about your coaching
      </p>
      <p className="mt-1 text-sm text-zinc-400">
        Who you coach, what you are good at, how long you have been at it.
      </p>
      <BriefField
        value={brief}
        onChange={setBrief}
        onError={setNote}
        micLabel="Say what your coaching is like"
        placeholder="Nine years at my club, mostly adults in the local league."
      />
      {note && <p className="mt-3 text-sm text-amber-400">{note}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setNote(null);
          }}
          className="rounded-full border border-edge bg-surface px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={run}
          disabled={busy || brief.trim().length < 15}
          className="glow-cta flex-1 rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {busy ? "Writing" : "Write my page"}
        </button>
      </div>
    </div>
  );
}

/**
 * Blocks the coach writes themselves.
 *
 * Headline, credentials and a bio cover most people, and then one wants
 * to list their blade and rubbers, another the league they run. Rather
 * than guess the next five fields, they get to name their own. Discreet
 * by design: a plain add button, nothing at all until they use it.
 */
function SectionsBlock({
  sections,
  setSections,
}: {
  sections: CoachSection[];
  setSections: (s: CoachSection[]) => void;
}) {
  const edit = (i: number, patch: Partial<CoachSection>) =>
    setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="mt-5 border-t border-edge/60 pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Your own sections
        </span>
        {sections.length < 6 && (
          <button
            type="button"
            onClick={() => setSections([...sections, { title: "", body: "" }])}
            className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
          >
            + Add a section
          </button>
        )}
      </div>

      {sections.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">
          Anything else worth its own heading.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {sections.map((s, i) => (
            <div
              key={i}
              className="rounded-xl border border-edge bg-surface-2/40 p-4"
            >
              {/* Title over its full width, Remove underneath. Side by
                  side it left about three words of title on a phone. */}
              <AutoTextarea
                value={s.title}
                onChange={(e) =>
                  edit(i, { title: e.target.value.replace(/\n/g, "") })
                }
                rows={1}
                maxLength={60}
                placeholder="Section title, like Equipment"
                className="rounded-xl border border-edge bg-surface-2 px-4 py-2.5 text-sm font-medium text-zinc-100 outline-none focus:border-cyan-glow/50"
              />
              <AutoTextarea
                variant="composer"
                value={s.body}
                onChange={(e) => edit(i, { body: e.target.value })}
                rows={3}
                maxLength={600}
                placeholder="What you want to say under that heading."
                className="mt-2 rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
              />
              <button
                type="button"
                onClick={() => setSections(sections.filter((_, j) => j !== i))}
                className="mt-3 rounded-full border border-edge px-5 py-2 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-400"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
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
  sections,
  photoUrl,
  samples,
}: {
  name: string;
  headline: string;
  bio: string;
  credentials: string;
  sections: CoachSection[];
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
        {sections
          .filter((s) => s.title.trim() && s.body.trim())
          .map((s, i) => (
            <div key={i} className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {s.title}
              </h3>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                {s.body}
              </p>
            </div>
          ))}
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
  const [sections, setSections] = useState<CoachSection[]>(
    profile.sections ?? [],
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
        // A half-written section is not an error worth stopping a save
        // for. One with nothing in it is simply not a section.
        sections: sections
          .map((s) => ({
            title: s.title.trim().slice(0, 60),
            body: s.body.trim().slice(0, 600),
          }))
          .filter((s) => s.title && s.body)
          .slice(0, 6),
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
        <UpLink href="/coaching/orders" label="Orders" />
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

        {/* Above the boxes it fills, because that is the order a coach
            reads the card in and the point is to not face them empty. */}
        <ProfileDrafter
          onDrafted={(d) => {
            if (d.headline) setHeadline(d.headline);
            if (d.credentials.length) setCredentials(d.credentials.join("\n"));
            if (d.bio) setBio(d.bio);
            // Added to, never over: a coach may already have written one.
            // Matched on title so pressing the button twice tops up the
            // page instead of stacking the same heading again.
            if (d.sections.length) {
              setSections((prev) => {
                const have = new Set(
                  prev.map((s) => s.title.trim().toLowerCase()),
                );
                const fresh = d.sections.filter(
                  (s) => !have.has(s.title.trim().toLowerCase()),
                );
                return [...prev, ...fresh].slice(0, 6);
              });
            }
          }}
        />

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

        <SectionsBlock sections={sections} setSections={setSections} />

        {error && <p className="mt-3 text-xs text-amber-400">{error}</p>}

        <button
          type="button"
          onClick={() => save()}
          disabled={busy}
          className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-60 lg:w-auto lg:px-10"
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
          sections={sections}
          photoUrl={photoUrl}
          samples={samples}
        />
      </div>
    </div>
  );
}
