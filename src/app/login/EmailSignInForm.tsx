"use client";

import { useState, type FormEvent } from "react";
import { buildEmailConfirmRedirect } from "@/lib/auth/paths";
import { createClient } from "@/lib/supabase/client";

export function EmailSignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedEmail = email.trim();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: submittedEmail,
      options: {
        emailRedirectTo: buildEmailConfirmRedirect(
          window.location.origin,
          next,
        ),
      },
    });

    setLoading(false);
    if (signInError) {
      setError("We couldn't send the email. Wait a minute and try again.");
      return;
    }
    setSentEmail(submittedEmail);
  }

  if (sentEmail) {
    return (
      <div className="mt-6 text-center" aria-live="polite">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m4 7 8 6 8-6" />
          </svg>
        </div>
        <h2 className="mt-3 text-base font-semibold">Check your inbox</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          We sent a sign-in link to{" "}
          <strong className="font-medium text-zinc-200">{sentEmail}</strong>.
          Open it to finish signing in.
        </p>
        <button
          type="button"
          onClick={() => setSentEmail(null)}
          className="mt-4 text-sm font-medium text-cyan-glow transition-colors hover:text-white"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-edge" />
        <span className="text-xs text-zinc-500">or continue with email</span>
        <span className="h-px flex-1 bg-edge" />
      </div>
      <form onSubmit={submit}>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-zinc-200"
        >
          Email address
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          disabled={loading}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-white placeholder:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading}
          className="glow-cta mt-3 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Sending…" : "Continue with email"}
        </button>
        <p className="mt-3 text-center text-xs leading-relaxed text-zinc-500">
          We&apos;ll email you a secure sign-in link. No password needed.
        </p>
        {error && (
          <p
            role="alert"
            aria-live="polite"
            className="mt-3 text-center text-xs text-red-400"
          >
            {error}
          </p>
        )}
      </form>
    </>
  );
}
