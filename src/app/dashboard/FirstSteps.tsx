"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The first-steps checklist: the four actions that make PongLens click,
 * derived from what the account has actually done — no step flags to keep
 * in sync, the product state IS the checklist. Home renders it only while
 * the account is new (under a few matches), and it disappears for good
 * once every step is done or the owner hides it.
 *
 * "Create your account" is already done by definition; starting a list at
 * 1 of 5 reads better than starting at zero.
 *
 * Dismissal lives in auth user_metadata (first_steps_dismissed), the same
 * place the display name lives — no table, readable everywhere.
 */

interface Steps {
  scored: boolean;
  starred: boolean;
  noted: boolean;
  focus: boolean;
  shared: boolean;
}

export function FirstSteps({
  userId,
  dismissed,
  hasUpload,
  hasReel,
  latestReadyId,
}: {
  userId: string;
  /** user_metadata.first_steps_dismissed, read server-side. */
  dismissed: boolean;
  /** Any own match or queued/processing job. */
  hasUpload: boolean;
  /** Any rendered export. */
  hasReel: boolean;
  /** A ready match to point the remaining steps at, if one exists. */
  latestReadyId: string | null;
}) {
  const [steps, setSteps] = useState<Steps | null>(null);
  const [hidden, setHidden] = useState(dismissed);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [pointRes, starRes, noteRes, focusRes, shareRes, coachRes] =
        await Promise.all([
          // A point the owner actually called: confirmed_winner is the
          // user's answer (plain `winner` is the vision guess).
          supabase
            .from("points")
            .select("id, matches!inner(user_id)")
            .eq("matches.user_id", userId)
            .not("confirmed_winner", "is", null)
            .limit(1),
          supabase
            .from("points")
            .select("id, matches!inner(user_id)")
            .eq("matches.user_id", userId)
            .eq("starred", true)
            .limit(1),
          supabase
            .from("notes")
            .select("id")
            .eq("author_id", userId)
            .limit(1),
          supabase
            .from("focus_points")
            .select("id")
            .eq("user_id", userId)
            .limit(1),
          supabase.from("share_links").select("id").limit(1),
          supabase
            .from("coach_links")
            .select("id")
            .eq("player_id", userId)
            .limit(1),
        ]);
      if (cancelled) return;
      setSteps({
        scored: (pointRes.data?.length ?? 0) > 0,
        starred: (starRes.data?.length ?? 0) > 0,
        noted: (noteRes.data?.length ?? 0) > 0,
        focus: (focusRes.data?.length ?? 0) > 0,
        shared:
          (shareRes.data?.length ?? 0) > 0 ||
          (coachRes.data?.length ?? 0) > 0,
      });
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per mount: the checklist is a snapshot, not a live tracker.
  }, [hidden, userId]);

  if (hidden || steps === null) return null;

  const matchHref = latestReadyId ? `/match/${latestReadyId}` : null;
  const items: {
    label: string;
    done: boolean;
    /** Where the step happens; falls back to its guide before any match exists. */
    href: string | null;
  }[] = [
    { label: "Create your account", done: true, href: null },
    { label: "Upload your first match", done: hasUpload, href: "/upload" },
    {
      label: "Score a game",
      done: steps.scored,
      href: matchHref ?? "/learn/keep-score",
    },
    {
      label: "Star a highlight",
      done: steps.starred,
      href: matchHref ?? "/learn/score-points",
    },
    {
      label: "Add a note to a point",
      done: steps.noted,
      href: matchHref ?? "/learn/score-points",
    },
    {
      label: "Add what you're working on",
      done: steps.focus,
      href: "/journal",
    },
    {
      label: "Share or export a match",
      done: steps.shared || hasReel,
      href: matchHref ?? "/learn/share",
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  const dismiss = async () => {
    setHidden(true);
    const supabase = createClient();
    await supabase.auth.updateUser({
      data: { first_steps_dismissed: true },
    });
  };

  return (
    <section className="rounded-2xl border border-edge bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-zinc-100">First steps</h2>
        <div className="flex items-baseline gap-4">
          <span className="text-xs tabular-nums text-zinc-500">
            {doneCount} of {items.length}
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="text-xs font-medium text-zinc-600 transition-colors hover:text-zinc-300"
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
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4 10-10" />
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
                item.done ? "text-zinc-500 line-through decoration-zinc-700" : "text-zinc-200"
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
                    <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
                  </svg>
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-edge/60 pt-3 text-xs text-zinc-500">
        Every step has a guide in{" "}
        <Link
          href="/learn"
          className="font-medium text-cyan-glow transition-colors hover:text-white"
        >
          Learn
        </Link>
        .
      </p>
    </section>
  );
}
