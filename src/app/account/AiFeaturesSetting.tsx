"use client";

import { useState } from "react";
import { useAiConsent, writeAiConsent } from "@/components/AiConsentSheet";

/**
 * The Account switch behind the AI features sheet. Off writes
 * ai_features_enabled = false and the sheet comes back on the next use;
 * on writes true with a fresh stamp and version, the same as an Allow.
 * Row and switch match RecollectSetting beside it. "AI" is allowed on
 * this row by owner decision (spec 2026-09-14).
 */
export function AiFeaturesSetting({
  initialEnabled,
  version,
}: {
  initialEnabled: boolean;
  /** The current ai_consent_version from app_config. */
  version: string;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const consent = useAiConsent();

  const toggle = async () => {
    if (saving) return;
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setError(false);
    const ok = await writeAiConsent(next, version);
    if (ok) {
      consent.setEnabled(next);
    } else {
      setEnabled(!next);
      setError(true);
    }
    setSaving(false);
  };

  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200">AI features</p>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          Used by match checks, voice notes, Ask, summaries and photo
          reading. Recording and uploading matches need this.
        </p>
        {error && (
          <p className="mt-1 text-xs text-red-400">
            Couldn&apos;t save that change. Try again.
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="AI features"
        disabled={saving}
        onClick={() => void toggle()}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-60 ${
          enabled
            ? "border-cyan-glow bg-cyan-glow"
            : "border-zinc-600 bg-surface-2"
        }`}
      >
        {/* Knob pinned with `left`, as RecollectSetting explains: a
            translate off the button's centred static position lands the
            knob past the right edge. */}
        <span
          className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-all ${
            enabled ? "left-6" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
