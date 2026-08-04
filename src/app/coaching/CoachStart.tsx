"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * First visit to /coaching: claim a handle, get a profile. Everything else
 * (offerings, payouts, publishing) happens on the hub afterwards.
 */
export function CoachStart({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanHandle = handle.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const handleOk = /^[a-z0-9][a-z0-9-]{2,29}$/.test(cleanHandle);

  async function create() {
    if (!handleOk || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error: insertError } = await supabase
      .from("coach_profiles")
      .insert({
        user_id: user.id,
        handle: cleanHandle,
        display_name: name.trim().slice(0, 80),
      });
    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "That handle is taken. Try another."
          : "Could not create your page. Try again.",
      );
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Coaching
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">
        Offer paid match reviews to your players. You set the price, the
        scope and the turnaround. Students send you a match, you review it
        point by point, and PongLens handles the order and the payment.
      </p>

      <div className="mt-8 rounded-2xl border border-edge bg-surface p-5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Your name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
          placeholder="How students know you"
        />

        <label className="mt-5 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Your page
        </label>
        <div className="mt-2 flex items-center gap-1 rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm">
          <span className="text-zinc-500">ponglens.com/coach/</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={30}
            className="min-w-0 flex-1 bg-transparent text-zinc-100 outline-none"
            placeholder="your-name"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        {handle && !handleOk && (
          <p className="mt-2 text-xs text-zinc-500">
            Three to thirty characters: letters, numbers and dashes.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}

        <button
          type="button"
          onClick={create}
          disabled={!handleOk || busy}
          className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {busy ? "Creating" : "Create your coach page"}
        </button>
      </div>
    </div>
  );
}
