"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setAccepting(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("accept_coach_invite", {
      token,
    });
    if (rpcError) {
      setAccepting(false);
      setError(
        "Couldn't accept the invite. It may have been used or revoked."
      );
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void accept()}
        disabled={accepting}
        className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {accepting ? "Accepting…" : "Accept invite"}
      </button>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </>
  );
}
