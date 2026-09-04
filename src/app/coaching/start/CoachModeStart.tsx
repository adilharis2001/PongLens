"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { setWorkspace } from "@/lib/workspace";
import { activateCoachMode } from "./coachMode";

export function CoachModeStart({ userId }: { userId: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      setFailed(false);
      const supabase = createClient();

      try {
        await activateCoachMode(userId, {
          updateAccount: async () => {
            const { error } = await supabase.auth.updateUser({
              data: { is_coach: true },
            });
            if (error) throw error;
          },
          rememberWorkspace: setWorkspace,
        });
        if (cancelled) return;
        router.replace("/coaching");
        router.refresh();
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void setup();
    return () => {
      cancelled = true;
    };
  }, [attempt, router, userId]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-edge bg-surface px-6 py-10 text-center">
      <p className="text-sm text-zinc-300">
        {failed ? "We could not set up coach mode." : "Setting up coach mode…"}
      </p>
      {failed && (
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="glow-cta mt-5 rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink"
        >
          Try again
        </button>
      )}
    </div>
  );
}
