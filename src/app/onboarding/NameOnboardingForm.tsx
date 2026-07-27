"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  displayNameError,
  normalizeDisplayName,
} from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/client";

export function NameOnboardingForm({ next }: { next: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = displayNameError(name);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      data: { full_name: normalizeDisplayName(name) },
    });

    if (updateError) {
      setSaving(false);
      setError("We couldn’t save your name. Try again.");
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-7">
      <label
        htmlFor="onboarding-name"
        className="block text-sm font-medium text-zinc-200"
      >
        Your name
      </label>
      <input
        id="onboarding-name"
        type="text"
        autoComplete="name"
        autoFocus
        required
        maxLength={120}
        disabled={saving}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Alex"
        className="mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60 focus:ring-2 focus:ring-cyan-glow/15 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="mt-3 text-center text-xs text-red-400"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="glow-cta mt-4 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Saving…" : "Continue to PongLens"}
      </button>
    </form>
  );
}
