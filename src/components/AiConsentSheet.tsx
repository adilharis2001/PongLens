"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The AI features sheet (App Review 5.1.2(i)). Shown once, the first time
 * a feature would send the person's content to OpenAI or Deepgram, and
 * again after they switch it off in Account. Same bottom-sheet treatment
 * as ShareSheet: a sheet on a phone, a centred card on a laptop.
 *
 * The state lives in AiConsentProvider (mounted once in the root layout).
 * A feature asks with `const { ensure } = useAiConsent()` and
 * `if (!(await ensure())) return;` before its network call, or wraps the
 * call in fetchWithAiConsent, which also handles the server's backstop: a
 * 403 { error: "ai_consent_required" } reopens the sheet and retries once.
 *
 * Allow writes ai_features_enabled, ai_consent_at and ai_consent_version
 * on the caller's own player_profiles row, the same client-side upsert
 * the onboarding flow does. Not now writes nothing, so the sheet comes
 * back on the next use.
 *
 * The word "AI" is allowed here and on the Account switch by owner
 * decision (spec 2026-09-14); nowhere else gets it from this.
 */

export type EnsureOptions = {
  /** The server just refused, so the cached answer is stale: ask again
   *  whatever the local state says. */
  reask?: boolean;
};

export type AiConsentContextValue = {
  /** true = allowed, false = switched off, null = not asked or unknown. */
  enabled: boolean | null;
  /** Resolves true when the feature may go ahead. Opens the sheet when
   *  the answer is not already yes. */
  ensure: (options?: EnsureOptions) => Promise<boolean>;
  /** The Account switch reports its write here so the cache follows it. */
  setEnabled: (enabled: boolean) => void;
};

export const AiConsentContext = createContext<AiConsentContextValue | null>(
  null,
);

export function useAiConsent(): AiConsentContextValue {
  const value = useContext(AiConsentContext);
  if (!value) {
    throw new Error("useAiConsent needs AiConsentProvider above it.");
  }
  return value;
}

export type ConsentInfo = {
  aiConsentVersion: string | null;
  aiFeaturesEnabled: boolean | null;
};

/** The signed-in account's state and the version an Allow writes. Null
 *  when signed out or the request failed. */
export async function fetchConsentInfo(): Promise<ConsentInfo | null> {
  try {
    const res = await fetch("/api/consent", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ConsentInfo>;
    return {
      aiConsentVersion: data.aiConsentVersion ?? null,
      aiFeaturesEnabled:
        typeof data.aiFeaturesEnabled === "boolean"
          ? data.aiFeaturesEnabled
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Write the choice on the caller's own row. On writes the stamp and the
 * version; off writes only the flag, so the record of the earlier Allow
 * stays. Resolves false when nothing was written.
 */
export async function writeAiConsent(
  enabled: boolean,
  version: string | null,
): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const now = new Date().toISOString();
  const { error } = await supabase.from("player_profiles").upsert(
    enabled
      ? {
          user_id: user.id,
          ai_features_enabled: true,
          ai_consent_at: now,
          ai_consent_version: version,
          updated_at: now,
        }
      : { user_id: user.id, ai_features_enabled: false, updated_at: now },
    { onConflict: "user_id" },
  );
  return !error;
}

async function refusedForConsent(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    return body?.error === "ai_consent_required";
  } catch {
    return false;
  }
}

/**
 * fetch for a call that sends content to OpenAI or Deepgram: asks first,
 * and when the server refuses anyway (the switch was turned off in
 * another tab, say) asks again and retries once. Resolves null when the
 * person chose Not now, so the caller stops quietly. Bodies here are
 * FormData or JSON strings, both of which can be sent twice.
 */
export async function fetchWithAiConsent(
  ensure: AiConsentContextValue["ensure"],
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response | null> {
  if (!(await ensure())) return null;
  const first = await fetch(input, init);
  if (!(await refusedForConsent(first))) return first;
  if (!(await ensure({ reask: true }))) return null;
  return fetch(input, init);
}

export function AiConsentSheet({
  open,
  version,
  onAllow,
  onNotNow,
}: {
  open: boolean;
  /** The version stamp to write. Null when the read failed; Allow then
   *  reads it again before writing. */
  version: string | null;
  onAllow: () => void;
  onNotNow: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onNotNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onNotNow]);

  const allow = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const stamp = version ?? (await fetchConsentInfo())?.aiConsentVersion ?? null;
    const ok = await writeAiConsent(true, stamp);
    setSaving(false);
    if (!ok) {
      setError("Couldn't save that. Try again.");
      return;
    }
    onAllow();
  }, [saving, version, onAllow]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-consent-title"
    >
      <button
        type="button"
        aria-label="Not now"
        disabled={saving}
        onClick={onNotNow}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-8 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
        <h2 id="ai-consent-title" className="text-base font-semibold">
          AI features
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Some features send your content to two companies so they can do
          their job: Deepgram turns voice notes into text, and OpenAI reads
          notes, photos and lesson transcripts to write summaries, answer
          questions in Ask, and tidy rough entries. They are not allowed to
          use your content to train their models. You can switch this off
          any time in Account.
        </p>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void allow()}
            className="glow-cta inline-flex min-h-11 w-full items-center justify-center rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
          >
            Allow
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onNotNow}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
