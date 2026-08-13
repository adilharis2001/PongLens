"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { LocalTime } from "@/components/LocalTime";
import { createClient } from "@/lib/supabase/client";

export interface MarketingAccount {
  user_id: string;
  email: string;
  name: string;
  note: string | null;
  created_at: string;
}

/**
 * Who else may open this page. Only the owner sees this card, and only the
 * owner can act on it: admin_set_marketing() re-checks is_admin() in the
 * database, so the render check is UX rather than the boundary.
 */
export function MarketingAccessSection({
  accounts,
}: {
  accounts: MarketingAccount[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function setMarketing(target: string, enabled: boolean) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("admin_set_marketing", {
      p_email: target,
      p_enabled: enabled,
    });
    if (e) {
      setError(
        e.code === "P0002" || /user not found/.test(e.message)
          ? "No account with that email. They need to sign in to PongLens once first."
          : "Could not save. Try again.",
      );
    } else {
      setEmail("");
      setRemoving(null);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <section
      aria-label="Marketing access"
      className="mt-10 rounded-2xl border border-edge bg-surface/80 p-6 sm:p-7"
    >
      <h2 className="text-lg font-semibold tracking-tight text-white">
        Access
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        Everyone listed here can open this page and every space on it.
      </p>

      <form
        className="mt-5 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const target = email.trim();
          if (target) void setMarketing(target, true);
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          aria-label="Email address"
          className="w-64 max-w-full rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          Give access
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-amber-400">{error}</p>}

      {accounts.length === 0 ? (
        <p className="mt-5 text-sm text-zinc-500">No one else yet.</p>
      ) : (
        <ul className="mt-5 divide-y divide-edge/40">
          {accounts.map((a) => (
            <li
              key={a.user_id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-200">
                  {a.name || a.email}
                  {a.name && (
                    <span className="ml-2 text-zinc-500">{a.email}</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Since <LocalTime iso={a.created_at} mode="date" />
                  {a.note ? ` · ${a.note}` : ""}
                </p>
              </div>
              {removing === a.user_id ? (
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setMarketing(a.email, false)}
                    className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-surface-2"
                  >
                    Confirm remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(null)}
                    className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-surface-2"
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRemoving(a.user_id)}
                  className="shrink-0 rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2 hover:text-amber-400"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
