"use client";

import { useState } from "react";

export function RecollectSetting({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const toggle = async () => {
    if (saving) return;
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setError(false);
    try {
      const response = await fetch("/api/recollect/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) throw new Error("save failed");
    } catch {
      setEnabled(!next);
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200">Recollect</p>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          Bring useful guidance from lessons and practice notes back at the
          right time.
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
        aria-label="Recollect"
        disabled={saving}
        onClick={() => void toggle()}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-60 ${
          enabled
            ? "border-cyan-glow bg-cyan-glow"
            : "border-zinc-600 bg-surface-2"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
