"use client";
import { useState } from "react";
import {
  COACH_INTERESTS,
  PLAYER_INTERESTS,
  FEEDBACK_OPTIONS,
  optionsForRole,
  type BetaRole,
} from "@/lib/iosBeta/questionnaire";
import {
  feedbackLabel,
  invitationLabel,
  type BetaOutreachRow,
} from "./betaOutreachView";

export const OUTREACH_ACTION =
  "min-h-11 w-full rounded-full border border-edge px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-cyan-glow disabled:opacity-50 sm:w-auto";
const PRIMARY =
  "min-h-11 w-full rounded-full bg-cyan-glow px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-cyan-glow/90 disabled:opacity-50 sm:w-auto";
const INPUT =
  "w-full min-h-11 rounded-xl border border-edge bg-surface-2/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50";

export function BetaDetail({
  beta,
  onRefresh,
  onCorrection,
}: {
  beta: BetaOutreachRow;
  onRefresh: () => Promise<void>;
  onCorrection: (
    role: BetaRole | null,
    interests: string[],
    choice: string,
    channels: string[],
    note: string,
  ) => Promise<boolean>;
}) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [withdrawal, setWithdrawal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<BetaRole | null>(beta.role);
  const [interests, setInterests] = useState(beta.interests);
  const [choice, setChoice] = useState(beta.feedback_choice);
  const [channels, setChannels] = useState(beta.feedback_channels);
  const [note, setNote] = useState("");
  const label = invitationLabel(beta, new Date());
  const inviteAction = [
    "pending",
    "scheduled",
    "sending",
    "unknown",
    "failed",
    "needs_attention",
  ].includes(beta.delivery_state);
  const time = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  async function sendNow() {
    if (sending || beta.delivery_state === "sending") return;
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/ios-beta/${beta.id}/send`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        setMessage(
          result.status === "scheduled"
            ? "The invitation is still scheduled. Please try Send invite now again."
            : "The invitation status could not be confirmed. Refresh to check it.",
        );
      await onRefresh();
    } catch {
      setMessage(
        "The invitation status could not be confirmed. Refresh to check it.",
      );
    } finally {
      setSending(false);
    }
  }
  function startCorrection(withdraw: boolean) {
    setRole(beta.role);
    setInterests(beta.interests);
    setChoice(beta.feedback_choice);
    setChannels(beta.feedback_channels);
    setNote("");
    setWithdrawal(withdraw);
    setEditing(true);
  }
  async function save() {
    if (!note.trim() || saving) return;
    setSaving(true);
    try {
      const allowed = role
        ? new Set(optionsForRole(role).map((o) => o.value))
        : new Set<string>();
      const ok = await onCorrection(
        role,
        interests.filter((i) => allowed.has(i)),
        withdrawal ? "declined" : choice,
        withdrawal || choice !== "opted_in" ? [] : channels,
        note.trim(),
      );
      if (ok) setEditing(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="mt-4 text-sm">
      <h3 className="font-medium text-zinc-200">iPhone beta</h3>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-zinc-500">Role</dt>
          <dd className="text-zinc-200">
            {beta.role
              ? beta.role[0].toUpperCase() + beta.role.slice(1)
              : "Not provided"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Feedback contact</dt>
          <dd className="text-zinc-200">{feedbackLabel(beta)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Requested</dt>
          <dd className="text-zinc-200">{time(beta.created_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Invitation due</dt>
          <dd className="text-zinc-200">{time(beta.scheduled_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Invitation</dt>
          <dd
            className={
              label === "Needs attention" ? "text-amber-300" : "text-zinc-200"
            }
          >
            {label}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-zinc-500">Interests</p>
      {beta.interests.length ? (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-zinc-300">
          {beta.interests.map((i) => (
            <li key={i}>
              {[...PLAYER_INTERESTS, ...COACH_INTERESTS].find(
                (o) => o.value === i,
              )?.label ?? i}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-300">Not provided</p>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {inviteAction && (
          <button
            className={PRIMARY}
            disabled={sending || beta.delivery_state === "sending"}
            onClick={() => void sendNow()}
          >
            {sending || beta.delivery_state === "sending"
              ? "Sending…"
              : "Send invite now"}
          </button>
        )}
        <button
          className={OUTREACH_ACTION}
          onClick={() => startCorrection(false)}
        >
          Correct answers
        </button>
        {beta.feedback_choice === "opted_in" && (
          <button
            className={OUTREACH_ACTION}
            onClick={() => startCorrection(true)}
          >
            Record withdrawal
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="mt-3 text-zinc-300">
          {message}
        </p>
      )}
      {editing && (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {!withdrawal && (
            <>
              <label className="block text-zinc-400">
                Role
                <select
                  className={`${INPUT} mt-1`}
                  value={role ?? ""}
                  onChange={(e) =>
                    setRole((e.target.value || null) as BetaRole | null)
                  }
                >
                  <option value="">Not provided</option>
                  <option value="player">Player</option>
                  <option value="coach">Coach</option>
                  <option value="both">Both</option>
                </select>
              </label>
              {role && (
                <fieldset>
                  <legend className="text-zinc-400">Interests</legend>
                  {optionsForRole(role).map((o) => (
                    <label
                      className="flex min-h-11 items-start gap-3 py-2 text-zinc-300"
                      key={o.value}
                    >
                      <input
                        className="mt-1 accent-cyan-glow"
                        type="checkbox"
                        checked={interests.includes(o.value)}
                        onChange={(e) =>
                          setInterests((v) =>
                            e.target.checked
                              ? [...v, o.value]
                              : v.filter((i) => i !== o.value),
                          )
                        }
                      />
                      {o.label}
                    </label>
                  ))}
                </fieldset>
              )}
              <label className="block text-zinc-400">
                Feedback contact
                <select
                  className={`${INPUT} mt-1`}
                  value={choice}
                  onChange={(e) => setChoice(e.target.value as typeof choice)}
                >
                  <option value="unanswered">Not provided</option>
                  <option value="declined">
                    No feedback contact requested
                  </option>
                  <option value="opted_in">Opted in</option>
                </select>
              </label>
              {choice === "opted_in" && (
                <fieldset>
                  <legend className="text-zinc-400">Contact methods</legend>
                  {FEEDBACK_OPTIONS.filter((o) => o.value !== "not_now").map(
                    (o) => (
                      <label
                        className="flex min-h-11 items-center gap-3 text-zinc-300"
                        key={o.value}
                      >
                        <input
                          type="checkbox"
                          className="accent-cyan-glow"
                          checked={channels.includes(o.value)}
                          onChange={(e) =>
                            setChannels((v) =>
                              e.target.checked
                                ? [...v, o.value]
                                : v.filter((c) => c !== o.value),
                            )
                          }
                        />
                        {o.label}
                      </label>
                    ),
                  )}
                </fieldset>
              )}
            </>
          )}
          <label className="block text-zinc-400">
            {withdrawal ? "Withdrawal note" : "Verification note"}
            <textarea
              required
              maxLength={2000}
              className={`${INPUT} mt-1`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className={PRIMARY}
              disabled={
                saving ||
                !note.trim() ||
                (!withdrawal &&
                  ((choice === "opted_in" && !channels.length) ||
                    (role !== null &&
                      !interests.some((i) =>
                        optionsForRole(role).some((o) => o.value === i),
                      ))))
              }
            >
              {saving
                ? "Saving…"
                : withdrawal
                  ? "Save withdrawal"
                  : "Save correction"}
            </button>
            <button
              type="button"
              className={OUTREACH_ACTION}
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
