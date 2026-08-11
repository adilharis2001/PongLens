"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { UpLink } from "@/components/UpLink";

export interface QaAccount {
  user_id: string;
  email: string;
  name: string;
  note: string | null;
  created_at: string;
}

/**
 * The two controls behind test payments (092). A QA account is pinned to
 * test: purchases route through the simulated checkout, orders are
 * stamped test, and QA storefronts disappear from everyone else. The
 * admin toggle does the same for the admin account only, and goes back
 * to live with one press.
 */
export function TestingSection({
  initialAccounts,
  initialAdminTest,
}: {
  initialAccounts: QaAccount[];
  initialAdminTest: boolean;
}) {
  const router = useRouter();
  const [adminTest, setAdminTest] = useState(initialAdminTest);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function toggleAdminTest() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const next = !adminTest;
    const { error: e } = await supabase
      .from("app_config")
      .update({ value: next ? "true" : "false" })
      .eq("key", "admin_payments_test");
    if (e) setError("Could not save. Try again.");
    else setAdminTest(next);
    setBusy(false);
    router.refresh();
  }

  async function setQa(target: string, enabled: boolean) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("admin_set_qa", {
      p_email: target,
      p_enabled: enabled,
    });
    if (e) {
      setError(
        e.code === "P0002" || /user not found/.test(e.message)
          ? "No account with that email. They need to sign up first."
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
    <>
      <UpLink href="/admin" label="Admin" />
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        Testing
      </h1>

      <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              Your payments: {adminTest ? "test" : "live"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              In test, your purchases use the simulated checkout and count
              for nothing. Only your account is affected.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleAdminTest()}
            className={
              adminTest
                ? "glow-cta shrink-0 rounded-full bg-cyan-glow px-4 py-2 text-xs font-semibold text-ink"
                : "shrink-0 rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-surface-2"
            }
          >
            {adminTest ? "Back to live" : "Use test payments"}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-edge bg-surface p-5">
        <p className="text-sm font-medium text-zinc-200">QA accounts</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Always on test payments. They can only buy from other QA
          accounts, and their coach pages are hidden from everyone else.
        </p>

        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const target = email.trim();
            if (target) void setQa(target, true);
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className="w-64 max-w-full rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-surface-2 disabled:opacity-50"
          >
            Add
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-amber-400">{error}</p>}

        {initialAccounts.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No QA accounts yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-edge/40">
            {initialAccounts.map((a) => (
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
                    Since {new Date(a.created_at).toLocaleDateString()}
                    {a.note ? ` · ${a.note}` : ""}
                  </p>
                </div>
                {removing === a.user_id ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setQa(a.email, false)}
                      className="rounded-full border border-edge px-4 py-2 text-xs font-medium text-amber-400 hover:bg-surface-2"
                    >
                      Confirm remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(null)}
                      className="rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-surface-2"
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRemoving(a.user_id)}
                    className="shrink-0 rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-surface-2 hover:text-amber-400"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
