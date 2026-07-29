"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Invite codes: mint, hand out, watch them get used, revoke.
 * admin_create_invite / admin_invite_codes are is_admin()-gated RPCs
 * (043); revoking writes the table directly under the admin RLS policy.
 */

interface CodeRow {
  id: string;
  code: string;
  label: string;
  max_uses: number;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
  redeemers: string[];
}

export function InviteCodesSection() {
  const [codes, setCodes] = useState<CodeRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("admin_invite_codes");
    if (data) setCodes(data as CodeRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const uses = Number(maxUses);
    if (!Number.isInteger(uses) || uses < 1 || uses > 1000) {
      setError("Uses must be between 1 and 1000.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("admin_create_invite", {
      p_label: label.trim(),
      p_max_uses: uses,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setLabel("");
    setMaxUses("1");
    await load();
  };

  const revoke = async (id: string) => {
    setError(null);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("invite_codes")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    await load();
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // the code is on screen either way
    }
  };

  return (
    <section>
      <h2 className="text-lg font-semibold">Invite codes</h2>
      <p className="mt-1 text-sm text-zinc-500">
        A code lets someone into the app. One use each unless you say
        otherwise.
      </p>

      <form
        onSubmit={create}
        className="mt-4 flex flex-wrap items-center gap-2"
      >
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Who it's for (optional)"
          className="min-w-0 flex-1 rounded-xl border border-edge bg-surface px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
        />
        <input
          type="number"
          min={1}
          max={1000}
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          aria-label="Max uses"
          className="w-20 rounded-xl border border-edge bg-surface px-3 py-2.5 text-sm text-zinc-100 focus:border-cyan-glow/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
        >
          New code
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {codes === null ? null : codes.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No codes yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {codes.map((c) => {
            const dead = c.revoked_at !== null;
            const spent = c.use_count >= c.max_uses;
            return (
              <li key={c.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => void copy(c.code)}
                    title="Copy code"
                    className={`font-mono text-sm font-semibold tracking-[0.15em] transition-colors ${
                      dead
                        ? "text-zinc-600 line-through"
                        : "text-cyan-glow hover:text-white"
                    }`}
                  >
                    {copied === c.code ? "Copied" : c.code}
                  </button>
                  <span className="text-xs tabular-nums text-zinc-500">
                    {c.use_count}/{c.max_uses} used
                  </span>
                  {c.label && (
                    <span className="truncate text-xs text-zinc-400">
                      {c.label}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-3">
                    {dead ? (
                      <span className="text-xs text-zinc-600">Revoked</span>
                    ) : spent ? (
                      <span className="text-xs text-zinc-500">Used up</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void revoke(c.id)}
                        className="text-xs text-zinc-500 transition-colors hover:text-red-400"
                      >
                        Revoke
                      </button>
                    )}
                  </span>
                </div>
                {c.redeemers.length > 0 && (
                  <p className="mt-1 truncate text-xs text-zinc-500">
                    Used by {c.redeemers.join(", ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
