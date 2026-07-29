"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * No code? Raise a hand. request_access (044) files one request per
 * account; the admin portal approves or denies it. Approval grants
 * access directly, so an approved user just walks in on their next
 * visit — the gate never renders for them again.
 */
export function RequestInvite({
  initialStatus,
}: {
  initialStatus: "pending" | "approved" | "denied" | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);

  if (status === "pending") {
    return (
      <p className="text-center text-xs leading-relaxed text-zinc-500">
        Invite requested. You get in the moment it&apos;s approved, so check
        back soon.
      </p>
    );
  }
  if (status === "denied") {
    return (
      <p className="text-center text-xs leading-relaxed text-zinc-500">
        Your invite request wasn&apos;t approved this time.
      </p>
    );
  }

  const request = async () => {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("request_access");
    setBusy(false);
    if (!error) setStatus("pending");
  };

  return (
    <div className="text-center">
      <p className="text-xs leading-relaxed text-zinc-500">No code?</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void request()}
        className="mt-2 rounded-full border border-edge px-5 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-60"
      >
        {busy ? "Sending…" : "Request an invite"}
      </button>
    </div>
  );
}
