"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * A coach the player has taken off their list.
 *
 * Removal archives rather than deletes, so this page still exists and must
 * not 404. Back, a second open tab and every bookmark land here the instant
 * somebody presses Remove, and Next's generic not-found page would say
 * nothing about what happened and offer no way to undo it.
 *
 * Nothing about access is offered, because they have none. One sentence and
 * the way back.
 */
export function RemovedCoach({
  coachRefId,
  displayName,
}: {
  coachRefId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Link
        href="/coaching/coach"
        className="text-sm text-zinc-400 transition-colors hover:text-white"
      >
        ← Your coaches
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
        {displayName}
      </h1>

      <p className="mt-4 text-sm text-zinc-400">
        You removed them from your list.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const supabase = createClient();
          const { data, error: err } = await supabase.rpc(
            "restore_player_coach",
            { p_id: coachRefId },
          );
          setBusy(false);
          if (err) {
            setError("Couldn't put them back. Try again.");
            return;
          }
          if (data === "merged") {
            /* The slot was taken by a live row for the same account, so the
               lessons moved rather than the row coming back. Say where they
               went instead of returning to a page that is still archived. */
            router.replace("/coaching/coach");
            router.refresh();
            return;
          }
          router.refresh();
        }}
        className="glow-cta mt-5 w-full rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-60 sm:w-auto"
      >
        {busy ? "Putting back…" : "Put back"}
      </button>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </>
  );
}
