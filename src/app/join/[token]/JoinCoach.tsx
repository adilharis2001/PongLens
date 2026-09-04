"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The explicit half of joining a coach. The page above already said what
 * accepting means; this is the button that does it, once.
 *
 * Two questions sit above the button (161). The name, only when the
 * account has none yet: a student who created their account from the
 * invite lands here before onboarding's name step, and the coach's roster
 * copies the name at the moment of joining. And the access: all matches
 * including future uploads, or only the ones shared from a match page.
 * Both can be changed later, in Account and on the Coaching tab.
 */
export function JoinCoach({
  token,
  coachName,
  needsName,
}: {
  token: string;
  coachName: string;
  needsName: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [allMatches, setAllMatches] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanName = name.trim().replace(/\s+/g, " ");
  const canJoin = !busy && (!needsName || cleanName.length > 0);

  const join = async () => {
    if (!canJoin) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    if (needsName) {
      const { error: nameError } = await supabase.auth.updateUser({
        data: { full_name: cleanName },
      });
      if (nameError) {
        setBusy(false);
        setError("Couldn't save your name. Try again.");
        return;
      }
    }
    const { error: rpcError } = await supabase.rpc("accept_student_invite", {
      p_token: token,
      p_all_matches: allMatches,
    });
    if (rpcError) {
      setBusy(false);
      setError("Couldn't join. The link may have been revoked — ask for a new one.");
      return;
    }
    // The journal, opened on what the coach has already written rather
    // than on everything (Adil, 2026-09-04). A student joining a coach
    // they have worked with for months should land on their material,
    // not on a feed where it is mixed in among their own notes.
    router.replace("/journal?from=coach");
    router.refresh();
  };

  const option = (all: boolean, title: string, detail: string) => (
    <button
      type="button"
      aria-pressed={allMatches === all}
      onClick={() => setAllMatches(all)}
      className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
        allMatches === all
          ? "border-cyan-glow/60 bg-cyan-glow/10"
          : "border-edge bg-ink/40 hover:border-cyan-glow/40"
      }`}
    >
      <p className="text-sm font-semibold text-zinc-100">{title}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{detail}</p>
    </button>
  );

  return (
    <div className="mt-6 text-left">
      {needsName && (
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Your name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="How your coach knows you"
            className="mt-2 w-full rounded-xl border border-edge bg-ink/40 px-4 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
          />
        </label>
      )}

      <p
        className={`text-xs font-semibold uppercase tracking-wider text-zinc-500 ${
          needsName ? "mt-5" : ""
        }`}
      >
        What {coachName} can see
      </p>
      <div className="mt-2 space-y-2">
        {option(true, "All my matches", "Every match, including future uploads.")}
        {option(
          false,
          "Only matches I share",
          "You share each match from its page. Change this any time.",
        )}
      </div>

      <button
        type="button"
        onClick={join}
        disabled={!canJoin}
        className="glow-cta mt-5 w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {busy ? "Joining…" : `Join ${coachName}`}
      </button>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
