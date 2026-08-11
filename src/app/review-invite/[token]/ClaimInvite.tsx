"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function ClaimInvite({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: claimError } = await supabase.rpc(
      "claim_sponsored_invite",
      { p_token: token },
    );
    if (claimError) {
      setBusy(false);
      setError(
        claimError.message.includes("own_offering")
          ? "This link is for a student, and this is your own offering."
          : claimError.message.includes("coach_at_capacity")
            ? "Your coach's queue is full right now. Try again in a few days."
            : "This link is no longer active. Ask your coach for a new one.",
      );
      return;
    }
    router.replace(`/orders/${data as string}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void claim()}
        disabled={busy}
        className="glow-cta mt-5 w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {busy ? "Setting it up" : "Accept"}
      </button>
      {error && <p className="mt-3 text-sm text-amber-300/90">{error}</p>}
    </>
  );
}
