"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { createClient } from "@/lib/supabase/client";

type Preview = {
  matches: number;
  entries: number;
  /// Open review orders the server will settle as part of deleting:
  /// delivered reviews the user bought complete (the coach gets paid),
  /// everything else cancels with a refund. Nothing blocks any more.
  completions: number;
  refunds: number;
};

/**
 * Closing the account, as the last row of the Support group, where the iOS
 * app keeps it (Adil, 2026-09-05); it used to be a card of its own under
 * Sign out. Two steps on purpose: the row asks the server what would go and
 * only then opens the dialog, so the confirmation names real numbers instead
 * of a generic warning nobody reads.
 *
 * Rendered as one block so the card's divide-y draws a single rule above
 * it, error line included.
 */
export function DeleteAccountSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setError(null);
    setTyped("");
    setBusy(true);
    try {
      const res = await fetch("/api/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview" }),
      });
      const data = res.ok ? ((await res.json()) as Preview) : null;
      if (!data) {
        setError("Could not check your account. Try again.");
        return;
      }
      setPreview(data);
      setOpen(true);
    } catch {
      setError("Could not check your account. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", confirm: "DELETE" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Could not delete the account. Try again.");
        return;
      }
      // The session belongs to a user that no longer exists; clear it locally
      // so the app does not spend the next navigation discovering that.
      await createClient().auth.signOut();
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not delete the account. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const settling = (preview?.completions ?? 0) + (preview?.refunds ?? 0);

  return (
    <>
      <div>
        <button
          type="button"
          onClick={begin}
          disabled={busy}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
        >
          {busy && !open ? "Checking…" : "Delete account"}
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
          </svg>
        </button>
        {error && !open && (
          <p className="px-5 pb-3 text-sm text-red-400">{error}</p>
        )}
      </div>

      <ConfirmDialog
        open={open}
        title="Delete your account?"
        body="This removes your account and everything in it. It cannot be undone."
        confirmLabel="Delete account"
        busy={busy}
        error={error}
        confirmDisabled={typed.trim().toUpperCase() !== "DELETE"}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
        onConfirm={confirm}
      >
        <p className="text-sm text-zinc-400">
          Going for good: {preview?.matches ?? 0}{" "}
          {preview?.matches === 1 ? "match" : "matches"} with their video and
          points, {preview?.entries ?? 0} journal{" "}
          {preview?.entries === 1 ? "entry" : "entries"}, your notes, your
          stats, and any coach page you have.
        </p>
        {settling > 0 && (
          <p className="mt-2 text-sm text-zinc-400">
            {settling === 1
              ? "One review order is still open. "
              : `${settling} review orders are still open. `}
            {(preview?.refunds ?? 0) > 0 &&
              (preview?.refunds === 1
                ? "One will be cancelled and the payment refunded. "
                : `${preview?.refunds} will be cancelled and their payments refunded. `)}
            {(preview?.completions ?? 0) > 0 &&
              (preview?.completions === 1
                ? "A delivered review will be completed so the coach is paid."
                : `${preview?.completions} delivered reviews will be completed so the coaches are paid.`)}
          </p>
        )}
        <label className="mt-4 block text-sm text-zinc-400">
          Type DELETE to confirm
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 w-full rounded-lg border border-edge bg-ink/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
          />
        </label>
      </ConfirmDialog>
    </>
  );
}
