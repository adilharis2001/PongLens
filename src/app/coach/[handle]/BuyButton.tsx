"use client";

import { useState } from "react";

/**
 * Starts checkout for one offering. Signed-out visitors go to login first
 * and land back here; everything else redirects into checkout.
 */
export function BuyButton({
  offeringId,
  handle,
  price,
}: {
  offeringId: string;
  handle: string;
  price: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function buy() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/reviews/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offeringId }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(
          `/coach/${handle}`,
        )}`;
        return;
      }
      const body = (await res.json()) as { url?: string; code?: string };
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      setNote(
        body.code === "coach_at_capacity" || body.code === "coach_paused"
          ? "Not taking new orders right now."
          : body.code === "own_offering"
            ? "This one is yours."
            : "Something went wrong. Try again.",
      );
      setBusy(false);
    } catch {
      setNote("Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={buy}
        disabled={busy}
        className="glow-cta shrink-0 rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {busy ? "One moment" : `Buy ${price}`}
      </button>
      {note && <p className="mt-2 text-xs text-zinc-500">{note}</p>}
    </div>
  );
}
