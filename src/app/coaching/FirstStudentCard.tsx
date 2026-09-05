"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * What a coach with no students sees (Adil, 2026-09-05).
 *
 * The phone has had this since the coaching workspace shipped: an icon, a
 * sentence explaining what a student row is for, and the two ways to make
 * one. The web had "No students yet." in a box — under a seven-item
 * checklist, which makes it worse rather than better, because the first
 * screen of the product was then two lists and no door.
 *
 * ONE card at every width, not a phone layout shown on a desktop. The card
 * fills its column; the content inside is centred and capped at a reading
 * measure, which is how an empty state is meant to sit on a wide screen.
 * Nothing here is behind a breakpoint except the padding and two type
 * sizes.
 */

const COPY =
  "Keep lesson notes on each student and share them when they're ready. " +
  "An invite links them to their PongLens account, and the matches they " +
  "upload show up here.";

const ROW =
  "flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] font-medium text-zinc-100 transition-colors hover:bg-surface-2";

export function FirstStudentCard({
  coachId,
  /** Given on the Students page, where the add form is already on screen;
   *  the hub has no form, so its row navigates to the one that does. */
  onAddStudent,
}: {
  coachId: string;
  onAddStudent?: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  /** The standing invite that names nobody: whoever opens it becomes a
   *  student. Safe here in a way it is not elsewhere — a general invite
   *  can otherwise land beside a roster row a coach has been writing into
   *  and orphan it, and this card only ever shows when there are no rows
   *  at all. Reused rather than re-minted, so a link already sent keeps
   *  working. */
  const invite = useCallback(async () => {
    if (link || minting) return;
    setMinting(true);
    setFailed(false);
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("coach_student_invites")
      .select("token")
      .eq("coach_id", coachId)
      .is("student_id", null)
      .is("revoked_at", null)
      .limit(1);
    let token = existing?.[0]?.token as string | undefined;
    if (!token) {
      const { data } = await supabase
        .from("coach_student_invites")
        .insert({ coach_id: coachId, student_id: null })
        .select("token")
        .single();
      token = data?.token as string | undefined;
    }
    setMinting(false);
    if (!token) {
      setFailed(true);
      return;
    }
    setLink(`${window.location.origin}/join/${token}`);
  }, [coachId, link, minting]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused; the link is on screen to copy by hand.
    }
  };

  return (
    <section className="rounded-2xl border border-edge bg-surface px-5 py-9 sm:px-10 sm:py-12">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <svg
          viewBox="0 0 24 24"
          className="h-9 w-9 text-cyan-glow"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7.5 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 13c-3.3 0-6 1.8-6 4v1.5c0 .3.2.5.5.5h11c.3 0 .5-.2.5-.5V17c0-2.2-2.7-4-6-4Zm7.5 0c-.7 0-1.3.1-1.9.2 1.2 1 1.9 2.3 1.9 3.8v2h4.1c.2 0 .4-.2.4-.5V17c0-2.2-2.3-4-4.5-4Z" />
        </svg>

        <h2 className="mt-4 text-lg font-semibold text-zinc-100 sm:text-xl">
          Add your first student
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400 sm:text-[15px]">
          {COPY}
        </p>

        <div className="mt-6 w-full divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-ink/40 text-left">
          {onAddStudent ? (
            <button type="button" onClick={onAddStudent} className={ROW}>
              <PersonPlus />
              <span className="flex-1">Add a student</span>
              <Chevron />
            </button>
          ) : (
            <Link href="/coaching/students?add=1" className={ROW}>
              <PersonPlus />
              <span className="flex-1">Add a student</span>
              <Chevron />
            </Link>
          )}
          <button
            type="button"
            onClick={() => void invite()}
            disabled={minting}
            className={`${ROW} disabled:opacity-60`}
          >
            <LinkIcon />
            <span className="flex-1">
              {minting ? "Getting the link…" : "Invite a new student"}
            </span>
            <Chevron />
          </button>
        </div>

        {failed && (
          <p className="mt-3 text-sm text-amber-200">
            Couldn&apos;t get the link. Try again.
          </p>
        )}

        {link && (
          <div className="mt-4 w-full rounded-xl border border-edge bg-ink/40 p-4 text-left">
            <p className="text-sm text-zinc-400">
              Whoever opens this and signs in joins as your student.
            </p>
            <p className="mt-2 break-all rounded-lg bg-ink/60 px-3 py-2 font-mono text-xs text-zinc-300">
              {link}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void copy()}
                className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink sm:w-auto sm:py-2"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              {typeof navigator !== "undefined" && "share" in navigator && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator
                      .share({ title: "Join me on PongLens", url: link })
                      .catch(() => {});
                  }}
                  className="w-full rounded-full border border-edge bg-surface-2 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 sm:w-auto sm:py-2"
                >
                  Send the link
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PersonPlus() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-zinc-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 8v6M22 11h-6"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-zinc-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"
      />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-zinc-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );
}
