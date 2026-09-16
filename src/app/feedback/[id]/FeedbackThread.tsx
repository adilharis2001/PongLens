"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Avatar,
  CHIP,
  OfficialBadge,
  OfficialReply,
  SEVERITY_CHIP,
  STATUS_CHIP,
  STATUS_LABEL,
  TYPE_CHIP,
  VoteButton,
  relDate,
  type BoardItem,
  type ThreadComment,
} from "../boardShared";

/**
 * One post and everything said under it.
 *
 * The post at the top with its vote box; the maker's latest reply pinned
 * under the post when there is one; then every comment in the order it
 * was written, with a reply box at the end. Comments carry a first name
 * and a photo, "You" for your own, and the PongLens badge for the admin.
 *
 * Writing goes through feedback_post_comment, which is what rings the
 * other people's bells. Editing goes through feedback_edit_comment so the
 * row is stamped edited. Deleting is a plain delete: the row policy lets
 * the author and the admin do it and nobody else.
 */

const PILL =
  "inline-flex min-h-9 items-center justify-center rounded-full border border-edge px-3.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50";
const PRIMARY =
  "glow-cta inline-flex min-h-9 items-center justify-center rounded-full bg-cyan-glow px-4 text-sm font-semibold text-ink disabled:opacity-50";
const TEXTAREA =
  "w-full resize-y rounded-xl border border-edge bg-surface-2/60 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50";

function stamp(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FeedbackThread({
  itemId,
  userId,
  isAdmin,
}: {
  itemId: string;
  userId: string;
  isAdmin: boolean;
}) {
  const [item, setItem] = useState<BoardItem | null | undefined>(undefined);
  const [comments, setComments] = useState<ThreadComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  const loadItem = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("feedback_item", { p_item: itemId });
    const rows = (data ?? []) as BoardItem[];
    setItem(rows[0] ?? null);
  }, [itemId]);

  const loadThread = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase.rpc("feedback_thread", {
      p_item: itemId,
    });
    if (readError) {
      setError("Could not load the comments. Reload the page.");
      return;
    }
    setComments((data ?? []) as ThreadComment[]);
  }, [itemId]);

  useEffect(() => {
    void loadItem();
    void loadThread();
  }, [loadItem, loadThread]);

  const vote = useCallback(async () => {
    if (!item || item.hidden) return;
    const before = item;
    setItem({
      ...item,
      voted: !item.voted,
      vote_count: item.vote_count + (item.voted ? -1 : 1),
    });
    const supabase = createClient();
    const { data, error: voteError } = await supabase
      .rpc("feedback_toggle_vote", { p_item: item.id })
      .single();
    if (voteError) {
      setItem(before);
      return;
    }
    const row = data as { vote_count: number; voted: boolean };
    setItem((cur) => (cur ? { ...cur, vote_count: row.vote_count, voted: row.voted } : cur));
  }, [item]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const supabase = createClient();
    const { error: postError } = await supabase.rpc("feedback_post_comment", {
      p_item: itemId,
      p_body: body,
    });
    setSending(false);
    if (postError) {
      setError("Could not post that. Try again.");
      return;
    }
    setDraft("");
    if (replyRef.current) replyRef.current.style.height = "auto";
    await Promise.all([loadThread(), loadItem()]);
  }, [draft, sending, itemId, loadThread, loadItem]);

  const edit = useCallback(
    async (comment: ThreadComment, body: string) => {
      const supabase = createClient();
      const { error: editError } = await supabase.rpc("feedback_edit_comment", {
        p_comment: comment.id,
        p_body: body,
      });
      if (editError) {
        setError("Could not save that. Try again.");
        return false;
      }
      await loadThread();
      return true;
    },
    [loadThread]
  );

  const remove = useCallback(
    async (comment: ThreadComment) => {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("feedback_comments")
        .delete()
        .eq("id", comment.id);
      if (deleteError) {
        setError("Could not delete that. Try again.");
        return;
      }
      await Promise.all([loadThread(), loadItem()]);
    },
    [loadThread, loadItem]
  );

  const adminChange = useCallback(
    async (field: "status" | "type", value: string) => {
      if (!item) return;
      const before = item;
      setItem({ ...item, [field]: value } as BoardItem);
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("feedback_items")
        .update({ [field]: value })
        .eq("id", item.id);
      if (updateError) setItem(before);
    },
    [item]
  );

  if (item === undefined) {
    return (
      <div>
        <BackLink />
        <p className="mt-6 text-sm text-zinc-600">Loading…</p>
      </div>
    );
  }
  if (item === null) {
    return (
      <div>
        <BackLink />
        <p className="mt-6 text-sm text-zinc-400">This post is not on the board.</p>
      </div>
    );
  }

  const author = item.user_id === userId ? "You" : item.author_name;
  const officialComments = (comments ?? []).filter((c) => c.official);
  const pinned = officialComments[officialComments.length - 1] ?? null;

  return (
    <div>
      <BackLink />

      {/* The post */}
      <article className="mt-4 rounded-2xl border border-edge bg-surface p-5 sm:p-6">
        <div className="flex items-start gap-4">
          {!item.hidden && (
            <VoteButton count={item.vote_count} voted={item.voted} onVote={() => void vote()} size="lg" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-snug text-zinc-100 sm:text-xl">
              {item.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`${CHIP} capitalize ${TYPE_CHIP[item.type] ?? TYPE_CHIP.idea}`}>
                {item.type}
              </span>
              {item.severity && (
                <span
                  className={`${CHIP} capitalize ${SEVERITY_CHIP[item.severity] ?? SEVERITY_CHIP.minor}`}
                >
                  {item.severity}
                </span>
              )}
              {item.status !== "open" && (
                <span className={`${CHIP} ${STATUS_CHIP[item.status] ?? STATUS_CHIP.declined}`}>
                  {STATUS_LABEL[item.status]}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <Avatar name={item.author_name} src={item.author_avatar} />
                {author} · {relDate(item.created_at)}
              </span>
            </div>
          </div>
        </div>

        {item.body.trim() && item.body.trim() !== item.title.trim() && (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {item.body}
          </p>
        )}

        {Array.isArray(item.qa) && item.qa.length > 0 && (
          <div className="mt-4 space-y-2 border-l-2 border-edge pl-3">
            {item.qa.map((pair, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-zinc-500">{pair.q}</p>
                <p className="mt-0.5 text-sm text-zinc-300">{pair.a}</p>
              </div>
            ))}
          </div>
        )}

        {item.environment && (
          <p className="mt-3 text-xs text-zinc-500">
            {[
              item.environment.viewport,
              item.environment.at && new Date(item.environment.at).toLocaleString(),
              item.environment.ua,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        {Array.isArray(item.attachments) && item.attachments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {item.attachments.map((att) => {
              const src = `/api/feedback/image?key=${encodeURIComponent(att.key)}`;
              return (
                <a
                  key={att.key}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-20 w-20 overflow-hidden rounded-lg border border-edge bg-ink/40 transition-colors hover:border-cyan-glow/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="Feedback screenshot" loading="lazy" className="h-full w-full object-cover" />
                </a>
              );
            })}
          </div>
        )}

        {pinned && (
          <div className="mt-4">
            <OfficialReply text={pinned.body} at={pinned.created_at} clamp={false} />
          </div>
        )}

        {isAdmin && (
          <div className="mt-4 flex gap-2">
            <select
              value={item.status}
              onChange={(e) => void adminChange("status", e.target.value)}
              aria-label="Status"
              className="rounded-lg border border-edge bg-surface-2 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
            >
              {["open", "planned", "building", "done", "declined"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={item.type}
              onChange={(e) => void adminChange("type", e.target.value)}
              aria-label="Type"
              className="rounded-lg border border-edge bg-surface-2 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
            >
              {["bug", "idea", "improvement", "private"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
      </article>

      {/* The thread */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          {comments === null
            ? "Comments"
            : comments.length === 0
              ? "No comments yet"
              : `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}
        </h2>

        {comments && comments.length > 0 && (
          <ul className="mt-4 space-y-3">
            {comments.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                mine={c.user_id === userId}
                canDelete={c.user_id === userId || isAdmin}
                onEdit={(body) => edit(c, body)}
                onDelete={() => void remove(c)}
              />
            ))}
          </ul>
        )}

        {item.hidden ? (
          <p className="mt-4 text-sm text-zinc-500">
            This report is private, so there is no thread on it.
          </p>
        ) : (
          <div className="mt-4 rounded-2xl border border-edge bg-surface p-4">
            <textarea
              ref={replyRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
              }}
              rows={2}
              placeholder={comments && comments.length > 0 ? "Add a comment" : "Be the first to comment"}
              aria-label="Your comment"
              className={TEXTAREA}
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={sending || !draft.trim()}
                onClick={() => void send()}
                className={PRIMARY}
              >
                {sending ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/feedback"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-400 transition-colors hover:text-white"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
      </svg>
      Feedback and discussion
    </Link>
  );
}

/**
 * One comment. Your own carries Edit and Delete; the admin's carry Delete
 * for anyone. Both are word buttons at the end of the row, the dress an
 * element-attached action gets.
 */
function CommentRow({
  comment,
  mine,
  canDelete,
  onEdit,
  onDelete,
}: {
  comment: ThreadComment;
  mine: boolean;
  canDelete: boolean;
  onEdit: (body: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState(comment.body);
  const [saving, setSaving] = useState(false);

  const name = comment.official ? null : mine ? "You" : comment.author_name;

  return (
    <li
      className={`rounded-2xl border p-4 ${
        comment.official
          ? "border-cyan-glow/30 bg-cyan-glow/[0.04]"
          : "border-edge bg-surface"
      }`}
    >
      <div className="flex items-center gap-2">
        <Avatar name={comment.author_name} src={comment.author_avatar} size={24} />
        {comment.official ? (
          <OfficialBadge />
        ) : (
          <span className="text-sm font-medium text-zinc-200">{name}</span>
        )}
        <span className="text-[11px] text-zinc-500" title={stamp(comment.created_at)}>
          {relDate(comment.created_at)}
          {comment.edited_at ? " · edited" : ""}
        </span>
      </div>

      {editing ? (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            autoFocus
            aria-label="Edit your comment"
            className={TEXTAREA}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText(comment.body);
              }}
              className={PILL}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !text.trim() || text.trim() === comment.body}
              onClick={async () => {
                setSaving(true);
                const ok = await onEdit(text.trim());
                setSaving(false);
                if (ok) setEditing(false);
              }}
              className={PRIMARY}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
          {comment.body}
        </p>
      )}

      {!editing && (mine || canDelete) && (
        <div className="mt-2 flex items-center gap-3">
          {confirming ? (
            <>
              <span className="text-sm text-zinc-400">Delete this comment?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
                className={`${PILL} hover:border-amber-400/60 hover:text-amber-200`}
              >
                Delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={PILL}>
                Keep
              </button>
            </>
          ) : (
            <>
              {mine && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Edit
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
