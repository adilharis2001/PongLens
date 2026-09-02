"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * A coach who switched to playing was never asked how they play (159).
 * Offered once, at the top of Home, where the answers matter; Set up goes
 * to the profile editor (which stamps it done), Skip stamps it here.
 */
export function PlayerSetupCard({ userId }: { userId: string }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const skip = async () => {
    setHidden(true);
    const supabase = createClient();
    await supabase
      .from("player_profiles")
      .update({ setup_done_at: new Date().toISOString() })
      .eq("user_id", userId);
  };

  return (
    <div className="mb-8 rounded-2xl border border-cyan-glow/30 bg-surface p-5">
      <p className="text-base font-semibold text-zinc-100">Set up your playing side</p>
      <p className="mt-1 text-sm text-zinc-400">
        Handedness, grip and level. Your stats and your coaches read them.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/account/player"
          className="glow-cta rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink"
        >
          Set up
        </Link>
        <button
          type="button"
          onClick={() => void skip()}
          className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
