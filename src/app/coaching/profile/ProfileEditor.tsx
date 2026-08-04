"use client";

import Link from "next/link";
import { useState } from "react";

import type { CoachProfileRow } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/client";

/**
 * Everything the storefront shows, editable in one place. Saves whole-form
 * on the button (these fields change rarely); publish is the same save.
 */
export function ProfileEditor({ profile }: { profile: CoachProfileRow }) {
  const [name, setName] = useState(profile.display_name);
  const [headline, setHeadline] = useState(profile.headline);
  const [bio, setBio] = useState(profile.bio);
  const [credentials, setCredentials] = useState(
    profile.credentials.join("\n"),
  );
  const [published, setPublished] = useState(profile.published);
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

  const field =
    "mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 " +
    "text-sm text-zinc-100 outline-none focus:border-cyan-glow/50";
  const label =
    "mt-5 block text-xs font-semibold uppercase tracking-wider text-zinc-500";

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href="/coaching"
        className="text-xs font-medium text-zinc-500 hover:text-zinc-300"
      >
        ← Coaching
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        Your page
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        ponglens.com/coach/{profile.handle}
      </p>

      <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
        <label className={label.replace("mt-5 ", "")}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className={field}
        />

        <label className={label}>Headline</label>
        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          maxLength={120}
          className={field}
          placeholder="Club coach, former national team"
        />

        <label className={label}>Credentials</label>
        <textarea
          value={credentials}
          onChange={(e) => setCredentials(e.target.value)}
          rows={3}
          className={field}
          placeholder={"One per line\nLevel 2 certified\n20 years coaching"}
        />

        <label className={label}>About you</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={6}
          maxLength={2000}
          className={field}
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
  );
}
