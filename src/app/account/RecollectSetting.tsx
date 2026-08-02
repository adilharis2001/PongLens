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
        {/* The knob is pinned with `left`, never with a translate off its
            static position. A button inherits text-align: center from the
            UA sheet (preflight doesn't reset it), and an absolutely
            positioned child with left:auto takes its static position from
            that centring — so the old translate-x-5 started 23px in and
            pushed the knob 16px past the right edge. `left` ignores the
            static position entirely, which is why every other toggle in
            the app has always been fine. */}
        <span
          className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-all ${
            enabled ? "left-6" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
