"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The explicit half of joining a coach. The page above already said what
 * accepting means; this is the button that does it, once.
 */
export function JoinCoach({
  token,
  coachName,
}: {
  token: string;
  coachName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("accept_student_invite", {
      p_token: token,
    });
    if (rpcError) {
      setBusy(false);
      setError("Couldn't join. The link may have been revoked — ask for a new one.");
      return;
    }
    router.replace("/journal");
    router.refresh();
  };

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={join}
        disabled={busy}
        className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {busy ? "Joining…" : `Join ${coachName}`}
      </button>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
