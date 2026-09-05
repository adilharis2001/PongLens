"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import {
  submitBetaSignup,
  type BetaSignupResult,
} from "@/lib/iosBeta/client";

function AppleMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

const errorCopy: Partial<Record<BetaSignupResult, string>> = {
  invalid_email: "Enter a valid email address.",
  rate_limited: "Too many requests from this connection. Try again in an hour.",
  unavailable: "We couldn’t send the beta link just now. Please try again.",
};

export function IosBetaSignup({
  placement,
}: {
  placement: "hero" | "platform";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<BetaSignupResult | "idle" | "loading">(
    "idle",
  );

  function openDialog() {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function resetDialog() {
    setEmail("");
    setCompany("");
    setStatus("idle");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setStatus(await submitBetaSignup(email, company));
  }

  return (
    <>
      {placement === "hero" ? (
        <button
          type="button"
          onClick={openDialog}
          aria-haspopup="dialog"
          className="group flex h-14 w-full max-w-80 items-center justify-center gap-2.5 rounded-full border border-cyan-glow/40 bg-cyan-glow/[0.06] px-6 text-base font-semibold text-cyan-glow backdrop-blur-sm transition-colors hover:border-cyan-glow/70 hover:bg-cyan-glow/[0.12] hover:text-cyan-100 sm:w-auto sm:max-w-none sm:text-lg"
        >
          <AppleMark className="h-5 w-5 shrink-0" />
          <span>Get the iPhone beta</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          aria-haspopup="dialog"
          className="group flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/[0.06] px-4 py-2 text-left transition-colors hover:border-cyan-glow/60 hover:bg-cyan-glow/[0.1]"
        >
          <AppleMark className="h-4 w-4 text-cyan-glow" />
          <span className="text-sm font-medium text-zinc-100">iOS</span>
          <span className="text-xs text-zinc-400">beta available</span>
          <span className="text-xs font-semibold text-cyan-glow transition-transform group-hover:translate-x-0.5">
            Get access →
          </span>
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={resetDialog}
        className="m-auto w-[calc(100%-2rem)] max-w-[460px] overflow-hidden rounded-[28px] border border-white/10 bg-[#101119] p-0 text-zinc-100 shadow-[0_24px_100px_rgba(0,0,0,.7),0_0_70px_rgba(42,199,229,.08)] backdrop:bg-black/80 backdrop:backdrop-blur-sm"
      >
        <div className="relative overflow-hidden px-6 py-7 sm:px-8 sm:py-8">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-cyan-glow/10 blur-3xl"
          />
          <button
            type="button"
            onClick={closeDialog}
            aria-label="Close iPhone beta signup"
            className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/20 text-xl leading-none text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
          >
            ×
          </button>

          {status === "success" ? (
            <div className="relative py-5 text-center" aria-live="polite">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow shadow-[0_0_30px_rgba(42,199,229,.18)]">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-6 w-6"
                >
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-glow">
                PongLens for iPhone
              </p>
              <h2 id={titleId} className="mt-2 text-2xl font-bold tracking-tight">
                The beta is headed your way.
              </h2>
              <p id={descriptionId} className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-zinc-400">
                Check <span className="font-medium text-zinc-200">{email}</span>{" "}
                for your TestFlight link and setup instructions.
              </p>
              <button
                type="button"
                onClick={closeDialog}
                className="mt-7 rounded-full bg-cyan-glow px-7 py-3 text-sm font-semibold text-ink transition-transform hover:scale-[1.02]"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="relative">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-glow/25 bg-cyan-glow/10 text-cyan-glow">
                <AppleMark className="h-5 w-5" />
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-glow">
                PongLens for iPhone
              </p>
              <h2 id={titleId} className="mt-2 pr-8 text-2xl font-bold tracking-tight sm:text-3xl">
                Send PongLens to your iPhone.
              </h2>
              <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
                Enter your email and we’ll send the TestFlight link and setup
                instructions.
              </p>

              <label htmlFor={`${titleId}-email`} className="mt-7 block text-sm font-medium text-zinc-200">
                Email address
              </label>
              <input
                ref={emailRef}
                id={`${titleId}-email`}
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                aria-invalid={status === "invalid_email"}
                aria-describedby={`${titleId}-message`}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3.5 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-glow/60 focus:ring-2 focus:ring-cyan-glow/10"
              />

              <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                <label htmlFor={`${titleId}-company`}>Company</label>
                <input
                  id={`${titleId}-company`}
                  name="company"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                />
              </div>

              <div id={`${titleId}-message`} aria-live="polite" className="min-h-6 pt-2 text-sm text-rose-300">
                {status !== "idle" && status !== "loading"
                  ? errorCopy[status]
                  : null}
              </div>

              <button
                type="submit"
                disabled={status === "loading"}
                className="glow-cta mt-2 flex w-full items-center justify-center rounded-full bg-cyan-glow px-6 py-3.5 text-base font-semibold text-ink disabled:cursor-wait disabled:opacity-60"
              >
                {status === "loading" ? "Sending…" : "Email me the beta link"}
              </button>
              <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
                Beta access and essential beta updates only. No marketing.
              </p>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
