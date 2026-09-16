"use client";

import Image from "next/image";

/**
 * What the board, a post's own page and the Home card share: the row
 * shape `feedback_board` / `feedback_item` return, the chip colours, the
 * short date, and the small pieces (avatar, vote box, official reply)
 * that have to look the same in all three places.
 */

export type BoardItem = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: "bug" | "idea" | "improvement" | "private";
  status: "open" | "planned" | "building" | "done" | "declined";
  qa: { q: string; a: string }[];
  vote_count: number;
  created_at: string;
  author_name: string;
  author_avatar: string | null;
  voted: boolean;
  // Private screenshots — the RPC only populates these for the item's
  // author or the admin; everyone else receives an empty array.
  attachments: { key: string; w?: number; h?: number }[];
  // QA fields (092). severity is public like type; environment comes back
  // null for everyone but the author and the admin.
  severity?: "blocker" | "major" | "minor" | null;
  environment?: { viewport?: string; ua?: string; at?: string } | null;
  // 101: the row is private, so it reaches only its author and the admin.
  hidden?: boolean;
  // Threads (2026-09-16).
  comment_count: number;
  last_activity_at: string;
  /** The admin's latest comment on this post, pinned under it. */
  official_reply: string | null;
  official_reply_at: string | null;
};

export type ThreadComment = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  author_name: string;
  author_avatar: string | null;
  /** Written by the admin: badged as PongLens rather than a first name. */
  official: boolean;
};

export const TYPE_CHIP: Record<string, string> = {
  bug: "border-red-400/40 bg-red-400/10 text-red-300",
  idea: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
  improvement: "border-violet-400/40 bg-violet-400/10 text-violet-300",
  private: "border-edge bg-surface-2 text-zinc-400",
};

export const SEVERITY_CHIP: Record<string, string> = {
  blocker: "border-red-400/40 bg-red-400/10 text-red-300",
  major: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  minor: "border-edge bg-surface-2 text-zinc-400",
};

export const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  building: "Building",
  done: "Done",
  declined: "Declined",
};

/**
 * One colour per stage so the rail and the chips agree: planned is a
 * promise, building is in motion, done is finished. Declined stays grey.
 */
export const STATUS_CHIP: Record<string, string> = {
  planned: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  building: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  done: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  declined: "border-edge bg-surface-2 text-zinc-400",
};

export const CHIP = "rounded-full border px-2 py-0.5 text-[10px] font-semibold";

export function relDate(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function Chevron({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 14 6-6 6 6" />
    </svg>
  );
}

export function BubbleIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 12a7 7 0 0 1-7 7H9l-4 3v-4.6A7 7 0 0 1 4 12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Z"
      />
    </svg>
  );
}

/** A first name's photo, or its initial when the account has none. */
export function Avatar({
  name,
  src,
  size = 16,
}: {
  name: string;
  src: string | null;
  size?: 16 | 24 | 28;
}) {
  const box = size === 28 ? "h-7 w-7" : size === 24 ? "h-6 w-6" : "h-4 w-4";
  const text = size === 16 ? "text-[9px]" : "text-[11px]";
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        unoptimized
        className={`${box} shrink-0 rounded-full border border-edge object-cover`}
      />
    );
  }
  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 ${text} font-medium text-zinc-400`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The maker's mark on a comment. Reads as the product, not a person. */
export function OfficialBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-glow">
      <span className="h-1.5 w-1.5 rounded-full bg-cyan-glow" aria-hidden="true" />
      PongLens
    </span>
  );
}

/**
 * The vote box: chevron over the count, lit when it is yours. The same
 * box on the board, on the post's page and on Home, so the count reads
 * as one thing everywhere.
 */
export function VoteButton({
  count,
  voted,
  onVote,
  size = "md",
}: {
  count: number;
  voted: boolean;
  onVote: () => void;
  size?: "md" | "lg";
}) {
  const dim = size === "lg" ? "w-12 py-2.5" : "w-10 py-1.5";
  return (
    <button
      type="button"
      onClick={onVote}
      aria-label={voted ? "Remove vote" : "Vote"}
      aria-pressed={voted}
      className={`flex ${dim} shrink-0 flex-col items-center rounded-xl border transition-colors ${
        voted
          ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
          : "border-edge bg-surface-2/40 text-zinc-400 hover:border-cyan-glow/40 hover:text-zinc-200"
      }`}
    >
      <Chevron className="h-4 w-4" />
      <span
        className={`font-semibold tabular-nums ${size === "lg" ? "text-sm" : "text-xs"}`}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * The admin's reply, pinned under a post. A left rule in the accent and
 * the badge, so a reader can tell in one glance that the maker answered
 * without opening the thread.
 */
export function OfficialReply({
  text,
  at,
  clamp = true,
}: {
  text: string;
  at: string | null;
  clamp?: boolean;
}) {
  return (
    <div className="mt-2 border-l-2 border-cyan-glow/60 pl-3">
      <div className="flex items-center gap-2">
        <OfficialBadge />
        {at && <span className="text-[11px] text-zinc-500">{relDate(at)}</span>}
      </div>
      <p
        className={`mt-1 text-sm leading-relaxed text-zinc-300 ${
          clamp ? "line-clamp-2" : "whitespace-pre-wrap"
        }`}
      >
        {text}
      </p>
    </div>
  );
}

/** "3" beside a bubble: how much has been said under a post. */
export function CommentCount({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-zinc-500"
      aria-label={`${count} ${count === 1 ? "comment" : "comments"}`}
    >
      <BubbleIcon className="h-3.5 w-3.5" />
      <span className="tabular-nums">{count}</span>
    </span>
  );
}
