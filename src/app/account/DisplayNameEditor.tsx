"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  displayNameError,
  normalizeDisplayName,
} from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/client";

export function DisplayNameEditor({
  initialName,
}: {
  initialName: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setName(initialName);
    setError(null);
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = displayNameError(name);
    if (validationError) {
      setError(validationError);
      return;
    }

    const fullName = normalizeDisplayName(name);
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      data: { full_name: fullName },
    });

    if (updateError) {
      setSaving(false);
      setError("We couldn’t save your name. Try again.");
      return;
    }

    setName(fullName);
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate font-medium text-zinc-100">{name}</p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-xs font-medium text-cyan-glow transition-colors hover:text-white"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="w-full max-w-sm">
      <label
        htmlFor="account-display-name"
        className="block text-xs font-medium text-zinc-400"
      >
        Your name
      </label>
      <input
        id="account-display-name"
        type="text"
        autoComplete="name"
        autoFocus
        required
        maxLength={120}
        disabled={saving}
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-cyan-glow/60 focus:ring-2 focus:ring-cyan-glow/15 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-cyan-glow px-4 py-1.5 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="text-xs font-medium text-zinc-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
