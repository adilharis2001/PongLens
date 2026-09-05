"use client";

import Link from "next/link";
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from "react";

import {
  submitBetaSignup,
  type BetaSignupResult,
} from "@/lib/iosBeta/client";
import {
  COACH_INTERESTS,
  FEEDBACK_OPTIONS,
  PLAYER_INTERESTS,
  optionsForRole,
  type BetaAnswers,
  type BetaRole,
} from "@/lib/iosBeta/questionnaire";

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
  invalid_answers: "Choose a role and at least one feature.",
  rate_limited: "Too many requests from this connection. Try again in an hour.",
  unavailable: "We couldn’t confirm your invitation schedule. Please try again.",
};

const roleOptions: readonly { value: BetaRole; label: string }[] = [
  { value: "player", label: "Player" },
  { value: "coach", label: "Coach" },
  { value: "both", label: "Both" },
];

const checkboxRow = "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm leading-5 text-zinc-200 transition-colors hover:border-white/20 has-[:checked]:border-cyan-glow/45 has-[:checked]:bg-cyan-glow/[0.07]";
const primaryButton = "glow-cta inline-flex min-h-11 w-full items-center justify-center rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:cursor-wait disabled:opacity-60 sm:w-auto";
const secondaryButton = "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/15 px-6 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white sm:w-auto";

function InterestOptions({
  options,
  selected,
  onToggle,
  firstInputRef,
  disabled,
}: {
  options: readonly { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string, checked: boolean) => void;
  firstInputRef?: RefObject<HTMLInputElement | null>;
  disabled: boolean;
}) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {options.map((option, index) => (
        <label key={option.value} className={checkboxRow}>
          <input
            ref={index === 0 ? firstInputRef : undefined}
            type="checkbox"
            disabled={disabled}
            value={option.value}
            checked={selected.includes(option.value)}
            onChange={(event) => onToggle(option.value, event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-glow"
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function IosBetaSignup({
  placement,
}: {
  placement: "hero" | "platform";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const firstRoleRef = useRef<HTMLInputElement>(null);
  const firstInterestRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const submissionRef = useRef(0);
  const titleId = useId();
  const roleHelpId = useId();
  const interestHelpId = useId();
  const feedbackHelpId = useId();
  const messageId = useId();
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState<BetaRole | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [roleError, setRoleError] = useState(false);
  const [interestError, setInterestError] = useState(false);
  const [status, setStatus] = useState<BetaSignupResult | "idle" | "loading">(
    "idle",
  );

  useEffect(() => {
    if (status === "success") confirmationRef.current?.focus();
  }, [status]);

  function openDialog() {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  function closeDialog() {
    submissionRef.current += 1;
    dialogRef.current?.close();
  }

  function resetDialog() {
    submissionRef.current += 1;
    setEmail("");
    setCompany("");
    setRole(null);
    setInterests([]);
    setFeedback([]);
    setRoleError(false);
    setInterestError(false);
    setStatus("idle");
  }

  function focusError(target: HTMLInputElement | null) {
    requestAnimationFrame(() => {
      target?.focus();
      target?.scrollIntoView({ block: "center" });
    });
  }

  function chooseRole(nextRole: BetaRole) {
    setRole(nextRole);
    setRoleError(false);
    const allowed = new Set(optionsForRole(nextRole).map((option) => option.value));
    if (interests.some((value) => allowed.has(value))) setInterestError(false);
    if (status !== "idle") setStatus("idle");
  }

  function toggleInterest(value: string, checked: boolean) {
    setInterests((current) => checked
      ? [...current, value]
      : current.filter((item) => item !== value));
    if (checked) setInterestError(false);
    if (status !== "idle") setStatus("idle");
  }

  function toggleFeedback(value: string, checked: boolean) {
    setFeedback((current) => {
      if (!checked) return current.filter((item) => item !== value);
      if (value === "not_now") return ["not_now"];
      return [...current.filter((item) => item !== "not_now"), value];
    });
    if (status !== "idle") setStatus("idle");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading") return;
    if (!role) {
      setRoleError(true);
      focusError(firstRoleRef.current);
      return;
    }

    const allowed = new Set(optionsForRole(role).map((option) => option.value));
    const visibleInterests = interests.filter((value) => allowed.has(value));
    if (visibleInterests.length === 0) {
      setInterestError(true);
      focusError(firstInterestRef.current);
      return;
    }

    const answers: BetaAnswers = {
      formVersion: 2,
      role,
      interests: visibleInterests,
      feedback,
    };
    const submission = submissionRef.current + 1;
    submissionRef.current = submission;
    setStatus("loading");
    const result = await submitBetaSignup(email, company, fetch, answers);
    if (submissionRef.current !== submission || !dialogRef.current?.open) return;
    setStatus(result);
  }

  const visibleOptions = role ? optionsForRole(role) : [];
  const isSubmitting = status === "loading";

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
        onClose={resetDialog}
        className="m-auto max-h-[min(92dvh,820px)] w-[calc(100%-2rem)] max-w-[760px] overflow-hidden rounded-[28px] border border-white/10 bg-[#101119] p-0 text-zinc-100 shadow-[0_24px_100px_rgba(0,0,0,.7),0_0_70px_rgba(42,199,229,.08)] backdrop:bg-black/80 backdrop:backdrop-blur-sm"
      >
        <div className="relative max-h-[min(92dvh,820px)] overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
          <button
            type="button"
            onClick={closeDialog}
            aria-label="Close iPhone beta signup"
            className="absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-black/20 text-xl leading-none text-zinc-400 transition-colors hover:border-white/20 hover:text-white sm:right-4 sm:top-4"
          >
            ×
          </button>

          {status === "success" ? (
            <div className="py-5 text-left" aria-live="polite">
              <h2
                ref={confirmationRef}
                id={titleId}
                tabIndex={-1}
                className="pr-12 text-2xl font-bold tracking-tight outline-none"
              >
                Request received.
              </h2>
              <p className="mt-4 text-sm text-zinc-300">
                We’ll email your TestFlight link within 24 hours.
              </p>
              <p className="mt-2 break-all text-sm font-medium text-zinc-100">{email}</p>
              <div className="mt-7 flex">
                <button type="button" onClick={closeDialog} className={primaryButton}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="text-left">
              <h2 id={titleId} className="pr-12 text-2xl font-bold tracking-tight sm:text-3xl">
                Join the iPhone beta
              </h2>

              <label htmlFor={`${titleId}-email`} className="mt-7 block text-sm font-medium text-zinc-200">
                Email
              </label>
              <input
                ref={emailRef}
                id={`${titleId}-email`}
                type="email"
                disabled={isSubmitting}
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (status !== "idle") setStatus("idle");
                }}
                placeholder="you@example.com"
                aria-invalid={status === "invalid_email"}
                aria-describedby={status === "invalid_email" ? messageId : undefined}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3.5 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-glow/60 focus:ring-2 focus:ring-cyan-glow/10"
              />

              <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                <label htmlFor={`${titleId}-company`}>Company</label>
                <input
                  id={`${titleId}-company`}
                  name="company"
                  type="text"
                  disabled={isSubmitting}
                  tabIndex={-1}
                  autoComplete="off"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                />
              </div>

              <fieldset className="mt-7" aria-invalid={roleError} aria-describedby={roleError ? roleHelpId : undefined}>
                <legend className="text-sm font-medium text-zinc-200">I’m joining as a</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {roleOptions.map((option, index) => (
                    <label key={option.value} className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 px-2 py-2 text-sm text-zinc-300 transition-colors has-[:checked]:border-cyan-glow/60 has-[:checked]:bg-cyan-glow/10 has-[:checked]:text-white">
                      <input
                        ref={index === 0 ? firstRoleRef : undefined}
                        type="radio"
                        disabled={isSubmitting}
                        name={`${titleId}-role`}
                        value={option.value}
                        checked={role === option.value}
                        onChange={() => chooseRole(option.value)}
                        className="h-4 w-4 shrink-0 accent-cyan-glow"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                {roleError ? (
                  <p id={roleHelpId} role="alert" className="mt-2 text-sm text-rose-300">
                    Choose Player, Coach, or Both.
                  </p>
                ) : null}
              </fieldset>

              <fieldset className="mt-7" aria-invalid={interestError} aria-describedby={interestError ? interestHelpId : undefined}>
                <legend className="text-sm font-medium text-zinc-200">What features are you excited to try?</legend>
                <p className="mt-1 text-sm text-zinc-500">Select all that apply.</p>
                {role === "both" ? (
                  <>
                    <div className="mt-4">
                      <h3 className="text-sm font-medium text-zinc-300">Player</h3>
                      <InterestOptions
                        options={PLAYER_INTERESTS}
                        selected={interests}
                        onToggle={toggleInterest}
                        firstInputRef={firstInterestRef}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="mt-5">
                      <h3 className="text-sm font-medium text-zinc-300">Coach</h3>
                      <InterestOptions
                        options={COACH_INTERESTS}
                        selected={interests}
                        onToggle={toggleInterest}
                        disabled={isSubmitting}
                      />
                    </div>
                  </>
                ) : role ? (
                  <InterestOptions
                    options={visibleOptions}
                    selected={interests}
                    onToggle={toggleInterest}
                    firstInputRef={firstInterestRef}
                    disabled={isSubmitting}
                  />
                ) : null}
                {interestError ? (
                  <p id={interestHelpId} role="alert" className="mt-2 text-sm text-rose-300">
                    Select at least one feature.
                  </p>
                ) : null}
              </fieldset>

              <fieldset className="mt-7" aria-describedby={feedbackHelpId}>
                <legend className="text-sm font-medium text-zinc-200">Would you be open to sharing feedback?</legend>
                <p id={feedbackHelpId} className="mt-1 text-sm leading-5 text-zinc-500">
                  Choose how we can contact you about your experience. This is optional and won’t affect beta access.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {FEEDBACK_OPTIONS.map((option) => (
                    <label key={option.value} className={checkboxRow}>
                      <input
                        type="checkbox"
                        disabled={isSubmitting}
                        value={option.value}
                        checked={feedback.includes(option.value)}
                        onChange={(event) => toggleFeedback(option.value, event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-glow"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <p className="mt-6 text-sm leading-5 text-zinc-400">
                We’ll use your email for beta access and essential beta updates, and to ask for feedback if you choose. No marketing. See our{" "}
                <Link href="/privacy" className="text-cyan-glow underline decoration-cyan-glow/40 underline-offset-2">
                  privacy policy
                </Link>.
              </p>

              <div id={messageId} aria-live="polite" className="min-h-6 pt-3 text-sm text-rose-300">
                {status !== "idle" && status !== "loading" ? errorCopy[status] : null}
              </div>

              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button type="submit" disabled={status === "loading"} className={primaryButton}>
                  {status === "loading" ? "Sending request…" : "Request beta access"}
                </button>
                <button type="button" onClick={closeDialog} className={secondaryButton}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
