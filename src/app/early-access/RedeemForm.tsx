"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The invite-code form. redeem_invite (043) validates and grants in one
 * call; on success the middleware's gate is open and a hard navigation
 * lands on the dashboard (hard on purpose — the middleware re-checks per
 * request, and a client-side transition could race the fresh row).
 */
export function RedeemForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("redeem_invite", {
      p_code: trimmed,
    });
    if (rpcError) {
      setBusy(false);
      setError("That code didn't work. Check it and try again.");
      return;
    }
    window.location.assign("/dashboard");
  };

  return (
    <form onSubmit={submit} className="mt-6">
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Invite code"
        aria-label="Invite code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={16}
        className="w-full rounded-xl border border-edge bg-ink px-4 py-3 text-center font-mono text-base tracking-[0.2em] text-zinc-100 placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
      />
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-center text-xs leading-relaxed text-red-300"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!code.trim() || busy}
        className="glow-cta mt-4 w-full rounded-full bg-cyan-glow px-7 py-3 text-sm font-semibold text-ink transition-opacity disabled:opacity-40"
      >
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
