"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The coach's first-steps checklist, the dashboard idiom for the other
 * side of the table: the actions that make the coaching side click,
 * derived from what the account has actually done — no step flags to
 * keep in sync, the product state IS the checklist. Home renders it
 * while the roster is small, and it goes for good once every step is
 * done or the coach hides it.
 *
 * "Create your account" is already done by definition; starting at
 * 1 of 8 reads better than starting at zero. Paid reviews and the videos
 * come last on purpose: a coach who only wants notes on their students
 * should never feel the marketplace is the point.
 *
 * Dismissal lives in auth user_metadata (coach_first_steps_dismissed),
 * beside the player checklist's flag.
 */
export interface CoachFirstStepsState {
  /** user_metadata.coach_first_steps_dismissed, read server-side. */
  dismissed: boolean;
  studentCount: number;
  /** The earliest active student, where the per-student steps happen. */
  firstStudentId: string | null;
  /** An invite link was minted, or a student is already connected. */
  invited: boolean;
  entryCount: number;
  anyShared: boolean;
  /** A match a student shared, if one exists. */
  sharedMatchId: string | null;
  hasPage: boolean;
  /** user_metadata.tutorial_started, set the first time a chapter plays. */
  watched: boolean;
}

export function CoachFirstSteps({ state }: { state: CoachFirstStepsState }) {
  const [hidden, setHidden] = useState(state.dismissed);
  if (hidden) return null;

  const studentHref = state.firstStudentId
    ? `/coaching/students/${state.firstStudentId}`
    : "/coaching/students?add=1";

  const items: { label: string; done: boolean; href: string | null }[] = [
    { label: "Create your account", done: true, href: null },
    {
      label: "Add your first student",
      done: state.studentCount > 0,
      href: "/coaching/students?add=1",
    },
    {
      label: "Send a student their invite link",
      done: state.invited,
      href: studentHref,
    },
    {
      label: "Write your first entry",
      done: state.entryCount > 0,
      href: studentHref,
    },
    {
      label: "Share an entry with a student",
      done: state.anyShared,
      href: studentHref,
    },
    {
      label: "Open a match a student shared",
      done: state.sharedMatchId !== null,
      href: state.sharedMatchId
        ? `/match/${state.sharedMatchId}`
        : "/learn/for-coaches",
    },
    {
      label: "Offer paid reviews",
      done: state.hasPage,
      href: "/coaching/orders",
    },
    {
      label: "Watch the tutorial videos",
      done: state.watched,
      href: "/learn/videos",
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  const dismiss = async () => {
    setHidden(true);
    const supabase = createClient();
    await supabase.auth.updateUser({
      data: { coach_first_steps_dismissed: true },
    });
  };

  return (
    <section className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-zinc-100">First steps</h2>
        <div className="flex items-baseline gap-4">
          <span className="text-xs tabular-nums text-zinc-500">
            {doneCount} of {items.length}
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300"
          >
            Hide
          </button>
        </div>
      </div>

      <ul className="mt-4 space-y-1">
        {items.map((item) => {
          const icon = item.done ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-cyan-glow">
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m5 13 4 4 10-10"
                />
              </svg>
            </span>
          ) : (
            <span
              className="h-5 w-5 shrink-0 rounded-full border border-edge"
              aria-hidden="true"
            />
          );
          const text = (
            <span
              className={`text-sm ${
                item.done
                  ? "text-zinc-500 line-through decoration-zinc-700"
                  : "text-zinc-200"
              }`}
            >
              {item.label}
            </span>
          );
          return (
            <li key={item.label}>
              {item.done || !item.href ? (
                <span className="flex items-center gap-3 rounded-xl px-2 py-2">
                  {icon}
                  {text}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2"
                >
                  {icon}
                  {text}
                  <svg
                    viewBox="0 0 24 24"
                    className="ml-auto h-4 w-4 text-zinc-600"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m9 6 6 6-6 6"
                    />
                  </svg>
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-edge/60 pt-3 text-xs text-zinc-500">
        How coaching works, step by step, in{" "}
        <Link
          href="/learn/for-coaches"
          className="font-medium text-cyan-glow transition-colors hover:text-white"
        >
          Learn
        </Link>
        .
      </p>
    </section>
  );
}
