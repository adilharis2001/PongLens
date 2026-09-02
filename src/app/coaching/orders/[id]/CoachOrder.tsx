"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FollowupThread, ReviewBody } from "@/components/reviews/ReviewReader";
import { formatUsd } from "@/lib/reviews/money";
import type {
  ReviewAttachmentRow,
  ReviewFindingRow,
  ReviewMessageRow,
  ReviewOrderDetail,
  ReviewSectionContent,
} from "@/lib/reviews/types";
import {
  runningScoreByPoint,
  sortPoints,
} from "@/app/match/[id]/gameScore";
import type { Point } from "@/lib/types";
import { ChatThread } from "@/components/reviews/ChatThread";
import { deliveryBlocker } from "@/lib/reviews/deliveryGate";
import { createClient } from "@/lib/supabase/client";
import { DictateButton } from "@/components/DictateButton";
import { FindingEditor } from "./FindingEditor";
import { UpLink } from "@/components/UpLink";
import { AutoTextarea } from "@/components/AutoTextarea";
import { OriginalVideoButton } from "@/components/OriginalVideo";

export interface WorkspacePoint {
  id: string;
  idx: number;
  confirmed_winner: "user" | "opponent" | null;
  starred: boolean;
  is_let: boolean;
  deleted: boolean;
  /** Padded clip start inside the cut video (null on pre-cut matches). */
  cut_t0: number | null;
  /** Source-video time; only used to order the score walk. */
  t0: number | null;
  game_end_override: "end" | "continue" | null;
  /** Owner-named winner of a game a pinned end closed at an unprovable
   *  score (099) — the games chip must agree with the match page. */
  game_winner_override: "user" | "opponent" | null;
}

interface MatchRow {
  id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string | null;
  status: string;
}

/**
 * One order, coach view. Submitted orders are an accept/decline decision
 * with the student's brief in full; accepted orders open the workspace
 * (findings, write-up sections, attachments, deliver); delivered orders
 * read exactly what the student sees, plus follow-up replies.
 */
export function CoachOrder({
  detail,
  messages,
  docSections,
  findings,
  links,
  attachments,
  match,
  points,
  skipSpans = [],
  userId,
  sponsored = false,
  hasOriginal = false,
}: {
  detail: ReviewOrderDetail;
  messages: ReviewMessageRow[];
  docSections: ReviewSectionContent[] | null;
  findings: ReviewFindingRow[];
  links: { finding_id: string; point_id: string }[];
  attachments: ReviewAttachmentRow[];
  match: MatchRow | null;
  points: WorkspacePoint[];
  /** Dead footage the workspace player jumps (playhead.skipSpans). */
  skipSpans?: { start: number; end: number }[];
  userId: string;
  /** funding = 'sponsored' (096): the coach covers this one. */
  sponsored?: boolean;
  /** Is there an original upload behind this match? Server-resolved from
   *  matches.raw_path, which the retention sweep never expires while the
   *  library row lives. */
  hasOriginal?: boolean;
}) {
  const router = useRouter();
  const s = detail.status;

  // Which shape the desktop workspace is in, remembered per device. Read
  // after mount rather than during render: the server has no localStorage,
  // and seeding state from it directly is a hydration mismatch.
  const [focus, setFocusState] = useState(false);
  useEffect(() => {
    setFocusState(
      window.localStorage.getItem("ponglens:coach-focus") === "1",
    );
  }, []);
  const setFocus = (on: boolean) => {
    setFocusState(on);
    window.localStorage.setItem("ponglens:coach-focus", on ? "1" : "0");
  };

  const findingPoints: Record<string, { point_id: string; idx: number }[]> = {};
  const idxById = new Map(points.map((p) => [p.id, p.idx]));
  for (const l of links) {
    (findingPoints[l.finding_id] ??= []).push({
      point_id: l.point_id,
      idx: idxById.get(l.point_id) ?? 0,
    });
  }
  for (const list of Object.values(findingPoints)) {
    list.sort((a, b) => a.idx - b.idx);
  }

  // The delivered reader's reel chips: running score at each cited point,
  // from the same walk the match page uses. Only when the match has any
  // scoring at all — a wall of 0-0 chips says nothing.
  const orderedPoints = sortPoints(
    points.filter((p) => !p.deleted) as unknown as Point[],
  );
  const reelScores = orderedPoints.some((p) => p.confirmed_winner !== null)
    ? Object.fromEntries(runningScoreByPoint(orderedPoints))
    : undefined;

  const header = (
    <>
      <UpLink href="/coaching/orders" label="Orders" />
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {detail.student_name}
        </h1>
        <span className="shrink-0 text-sm tabular-nums text-zinc-400">
          {sponsored ? (
            "Sponsored by you"
          ) : (
            <>
              {formatUsd(detail.coach_share_cents)}
              <span className="text-zinc-600">
                {" "}
                of {formatUsd(detail.price_cents)}
              </span>
            </>
          )}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        {detail.offering_title}
        {detail.promised_by &&
          (s === "in_review" || s === "clarification") &&
          ` · promised by ${new Date(detail.promised_by).toLocaleDateString(
            undefined,
            { weekday: "short", month: "short", day: "numeric" },
          )}`}
      </p>
      {match && match.status === "ready" && (
        <p className="mt-2 text-sm text-zinc-500">
          <Link
            href={`/match/${match.id}`}
            className="text-zinc-400 hover:text-cyan-glow"
          >
            Open the full match
          </Link>{" "}
          for scores, placement and your notes.
        </p>
      )}
    </>
  );

  const brief = detail.intake_answers.length > 0 && (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Their brief
      </h2>
      <dl className="mt-3 space-y-3">
        {detail.intake_answers
          .filter((a) => a.answer)
          .map((a) => (
            <div key={a.id}>
              <dt className="text-xs text-zinc-500">{a.label}</dt>
              <dd className="mt-0.5 whitespace-pre-line text-sm text-zinc-300">
                {a.answer}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );

  if (s === "awaiting_submission") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <p className="mt-6 text-sm text-zinc-400">
          They haven&apos;t sent a match yet. The order starts when they do.
        </p>
      </div>
    );
  }

  if (s === "submitted") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        {brief}
        <AcceptDecline detail={detail} onDone={() => router.refresh()} />
      </div>
    );
  }

  if (s === "in_review" || s === "clarification") {
    // On a laptop this is a two-pane workspace: the player and patterns
    // pinned on the left, the brief, chat and write-up scrolling on the
    // right, so the coach watches while they write. One DOM serves both:
    // the pane wrappers are `display: contents` below lg, so the phone
    // keeps its single column untouched.
    // 60/40, not an even split: the picture is the coach's material.
    // Narrower than ~2fr and the write-up fields go phone-narrow.
    //
    // Focus mode drops the split entirely and gives the picture the whole
    // column, with everything else stacked underneath. Watching and writing
    // want different shapes, so it is a toggle rather than a decision made
    // once for everybody, and the choice is remembered.
    return (
      <div
        className={`mx-auto max-w-2xl lg:max-w-none lg:grid lg:items-start lg:gap-x-10 ${
          focus ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        }`}
      >
        <div className={focus ? "lg:col-span-1" : "lg:col-span-2"}>{header}</div>
        <Workspace
          focus={focus}
          onFocus={setFocus}
          detail={detail}
          brief={brief}
          docSections={docSections}
          findings={findings}
          findingPoints={findingPoints}
          attachments={attachments}
          points={points}
          skipSpans={skipSpans}
          messages={messages}
          matchId={match?.id ?? null}
          hasOriginal={hasOriginal}
          onChanged={() => router.refresh()}
        />
      </div>
    );
  }

  if (s === "delivered" || s === "completed") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <p className="mt-4 text-sm text-zinc-400">
          {s === "delivered"
            ? "Delivered. It completes when they mark it done, or after a quiet week."
            : "Completed. Your payout is on the way."}
          {detail.review_viewed_at && (
            <span className="text-cyan-glow"> They watched it.</span>
          )}
        </p>
        {s === "completed" && detail.testimonial && (
          <TestimonialReceived
            detail={detail}
            onChanged={() => router.refresh()}
          />
        )}
        {s === "completed" && (
          <InviteBack detail={detail} onChanged={() => router.refresh()} />
        )}
        {s === "completed" && <FeatureSample detail={detail} />}
        <div className="mt-8">
          <ReviewBody
            orderId={detail.id}
            sections={docSections ?? []}
            findings={findings}
            findingPoints={findingPoints}
            attachments={attachments}
            scores={reelScores}
          />
          <div className="mt-8">
            <FollowupThread
              orderId={detail.id}
              messages={messages}
              viewerId={userId}
              canAsk={s === "delivered"}
              askLabel="Reply"
              onSent={() => router.refresh()}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {header}
      <p className="mt-6 text-sm text-zinc-400">
        {s === "declined"
          ? "You declined this order. They were refunded in full."
          : "This order was cancelled and refunded."}
      </p>
    </div>
  );
}

/**
 * NOT the testimonial toggle above it: this shares the WHOLE review,
 * their match included, as the public sample on the storefront. Their
 * words were consented by sending; their footage needs an explicit yes,
 * so this asks them. The framing here exists to keep the two apart.
 */
function FeatureSample({ detail }: { detail: ReviewOrderDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const consent = detail.sample_consent;

  return (
    <div className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Sample review
      </h2>
      {consent === "approved" ? (
        <p className="mt-2 text-sm text-zinc-500">
          This is the public sample on your page. They said yes.
        </p>
      ) : consent === "requested" ? (
        <p className="mt-2 text-sm text-zinc-500">
          You asked to make this the public sample. Waiting on their OK.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-zinc-400">
            The whole review, their match included, shown publicly on your page.
            That needs their yes.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await createClient().rpc("request_review_sample", {
                p_order_id: detail.id,
              });
              setBusy(false);
              router.refresh();
            }}
            className="mt-3 rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 disabled:opacity-60"
          >
            {busy ? "Asking" : "Ask them"}
          </button>
        </>
      )}
    </div>
  );
}

function AcceptDecline({
  detail,
  onDone,
}: {
  detail: ReviewOrderDetail;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [message, setMessage] = useState("");

  async function accept() {
    setBusy(true);
    const res = await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: detail.id, action: "accept" }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDone();
  }

  async function decline() {
    setBusy(true);
    await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: detail.id,
        action: "decline",
        message: message.trim(),
      }),
    }).catch(() => {});
    setBusy(false);
    onDone();
  }

  return (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <p className="text-sm text-zinc-300">
        Accepting starts your {detail.turnaround_days}-day turnaround.
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="glow-cta mt-4 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {busy ? "One moment" : "Accept and start"}
      </button>
      {declining ? (
        <div className="mt-4">
          <AutoTextarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="A short note to them. They get a full refund."
            className="w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
          />
          <button
            type="button"
            onClick={decline}
            disabled={busy}
            className="mt-2 rounded-full border border-amber-400/50 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-400/10"
          >
            Decline and refund
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDeclining(true)}
          className="mt-3 w-full rounded-full border border-edge px-5 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-400"
        >
          Decline this order
        </button>
      )}
    </div>
  );
}

function Workspace({
  focus,
  onFocus,
  detail,
  brief,
  docSections,
  findings,
  findingPoints,
  attachments,
  points,
  skipSpans,
  messages,
  matchId,
  hasOriginal,
  onChanged,
}: {
  /** Desktop only: the picture takes the whole column, everything else
   *  stacks under it. Below lg the panes are display: contents and this
   *  changes nothing at all. */
  focus: boolean;
  onFocus: (on: boolean) => void;
  detail: ReviewOrderDetail;
  brief: React.ReactNode;
  docSections: ReviewSectionContent[] | null;
  findings: ReviewFindingRow[];
  findingPoints: Record<string, { point_id: string; idx: number }[]>;
  attachments: ReviewAttachmentRow[];
  points: WorkspacePoint[];
  /** Dead footage the workspace player jumps (playhead.skipSpans). */
  skipSpans: { start: number; end: number }[];
  messages: ReviewMessageRow[];
  matchId: string | null;
  /** Is there an original upload behind this match? Resolved on the
   *  server, so the pill is right at first paint. */
  hasOriginal: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDeliver, setConfirmDeliver] = useState(false);
  const [sectionNote, setSectionNote] = useState<string | null>(null);
  const clarifications = messages.filter((m) => m.kind === "clarification");

  const sectionDefs = detail.review_sections;
  const initialSections: ReviewSectionContent[] = sectionDefs.map((def) => {
    const existing = (docSections ?? []).find((x) => x.key === def.key);
    return { key: def.key, label: def.label, body: existing?.body ?? "" };
  });
  const [sections, setSections] = useState(initialSections);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  // Autosave the write-up two seconds after the last keystroke.
  function editSection(key: string, body: string) {
    const next = sections.map((x) => (x.key === key ? { ...x, body } : x));
    setSections(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      await createClient().rpc("save_review_document", {
        p_order_id: detail.id,
        p_sections: next,
      });
      setSaveState("saved");
    }, 2000);
  }
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  /**
   * The write-up tools. Both are the coach's own work being helped along,
   * so neither one delivers anything and both are reversible: tidy hands
   * back text the coach can undo in one press, check hands back a list.
   */
  const [tool, setTool] = useState<"tidy" | "check" | null>(null);
  const [undoTo, setUndoTo] = useState<ReviewSectionContent[] | null>(null);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [answered, setAnswered] = useState<
    { question: string; covered: boolean }[] | null
  >(null);
  /** The write-up as it stood when each tool last ran. While it matches,
   *  the button has nothing to do and says so. The server enforces this
   *  too, by hash: the button is the courtesy, not the control. */
  const [ranOn, setRanOn] = useState<{ tidy?: string; check?: string }>({});
  const written = sections.map((x) => x.body).join("\u0000");

  /** Write every section at once. editSection's debounce is per keystroke
   *  and would drop all but the last of a batch. */
  async function applySections(next: ReviewSectionContent[]) {
    setSections(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    await createClient().rpc("save_review_document", {
      p_order_id: detail.id,
      p_sections: next,
    });
    setSaveState("saved");
  }

  /** The server's word, in the coach's language. */
  function toolMessage(code: string | undefined): string {
    if (code === "too_many" || code === "too_many_order") {
      return "That is enough runs for now. Give it a little while.";
    }
    if (code === "nothing_written") return "Write something first.";
    if (code === "unchanged") return "Nothing has changed since the last run.";
    return "That did not work. Try again in a moment.";
  }

  async function runTidy() {
    setTool("tidy");
    setToolNote(null);
    try {
      const res = await fetch("/api/reviews/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: detail.id, action: "tidy" }),
      });
      const data = (await res.json()) as {
        sections?: { key: string; after: string; changed: boolean }[];
        code?: string;
      };
      if (!res.ok || !data.sections) {
        setToolNote(toolMessage(data.code));
        if (data.code === "unchanged") setRanOn((r) => ({ ...r, tidy: written }));
        return;
      }
      setRanOn((r) => ({ ...r, tidy: written }));
      const changed = data.sections.filter((x) => x.changed);
      if (changed.length === 0) {
        setToolNote("Nothing to change. It already reads well.");
        return;
      }
      const byKey = new Map(changed.map((x) => [x.key, x.after]));
      setUndoTo(sections);
      await applySections(
        sections.map((x) =>
          byKey.has(x.key) ? { ...x, body: byKey.get(x.key)! } : x,
        ),
      );
      setToolNote(
        changed.length === 1
          ? "Tidied one section."
          : `Tidied ${changed.length} sections.`,
      );
    } catch {
      setToolNote("That did not work. Try again in a moment.");
    } finally {
      setTool(null);
    }
  }

  async function undoTidy() {
    if (!undoTo) return;
    await applySections(undoTo);
    setUndoTo(null);
    setRanOn((r) => ({ ...r, tidy: undefined }));
    setToolNote("Put back the way you wrote it.");
  }

  async function runCheck() {
    setTool("check");
    setToolNote(null);
    try {
      const res = await fetch("/api/reviews/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: detail.id, action: "check" }),
      });
      const data = (await res.json()) as {
        answered?: { question: string; covered: boolean }[];
        code?: string;
      };
      if (!res.ok || data.code === "unchanged") {
        setToolNote(toolMessage(data.code));
        if (data.code === "unchanged") setRanOn((r) => ({ ...r, check: written }));
        return;
      }
      setRanOn((r) => ({ ...r, check: written }));
      setAnswered(data.answered ?? []);
    } catch {
      setToolNote("That did not work. Try again in a moment.");
    } finally {
      setTool(null);
    }
  }

  // Deterministic floor before delivery; the same check runs server-side.
  const blocker = deliveryBlocker(
    findings.map((f) => ({
      title: f.title,
      body: f.body,
      audio_path: f.audio_path,
      pointCount: (findingPoints[f.id] ?? []).length,
    })),
    sections,
  );
  const canDeliver = blocker === null;

  async function deliver() {
    setBusy(true);
    // Flush the draft first so delivery snapshots the latest words.
    await createClient().rpc("save_review_document", {
      p_order_id: detail.id,
      p_sections: sections,
    });
    const res = await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: detail.id, action: "deliver" }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onChanged();
  }

  return (
    <>
      {/* Below lg these wrappers are display: contents — invisible to
          layout, the phone column unchanged. At lg they become the grid's
          panes: brief and chat top right, the player pinned left with its
          own scroll, the write-up and delivery under the chat. */}
      <div
        className={`contents lg:block ${
          focus
            ? "lg:col-start-1 lg:row-start-3"
            : "lg:col-start-2 lg:row-start-2"
        }`}
      >
        {brief}
        {/* The chat: either side writes any time while the order is being
            worked. The last bubble says whose court the ball is in. */}
        <div className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Questions
          </h2>
          <div className="mt-3">
            <ChatThread
              orderId={detail.id}
              messages={clarifications}
              viewerId={detail.coach_id}
              otherName={detail.student_name}
              canWrite
              onSent={onChanged}
            />
          </div>
        </div>
      </div>

      {/* Sticky only in the split: pinned to the viewport it lets the coach
          scroll the write-up with the rally still on screen. At full width
          the picture is most of the viewport already, so pinning it would
          leave nothing to scroll the notes into. */}
      <div
        className={`contents lg:block ${
          focus
            ? "lg:col-start-1 lg:row-start-2"
            : "lg:sticky lg:top-20 lg:col-start-1 lg:row-start-2 lg:row-span-2 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto"
        }`}
      >
        <div className="mt-8 lg:mt-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">The points</h2>
            <div className="flex shrink-0 items-center gap-2">
              {/* The uncut upload, in the one place a coach actually
                  works. The player below is the CUT, and when the cut
                  came out poor — a rally clipped, a point dropped — the
                  original is the only honest answer. It opens in its own
                  full-screen player rather than repointing this one:
                  FindingEditor hands a single <video> element to every
                  finding card for frame capture, and a drawing grabbed
                  from the original would be filed against a point whose
                  cut_t0 belongs to the other file. */}
              {hasOriginal && matchId && (
                <OriginalVideoButton matchId={matchId} />
              )}
              <button
                type="button"
                onClick={() => onFocus(!focus)}
                className="hidden shrink-0 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white lg:inline-flex"
              >
                {focus ? "Split view" : "Full width"}
              </button>
            </div>
          </div>
          <FindingEditor
            orderId={detail.id}
            matchId={matchId}
            tall={focus}
            points={points}
            skipSpans={skipSpans}
            findings={findings}
            findingPoints={findingPoints}
            suggested={detail.suggested_patterns ?? []}
            onChanged={onChanged}
          />
        </div>
      </div>

      <div
        className={`contents lg:block ${
          focus
            ? "lg:col-start-1 lg:row-start-4"
            : "lg:col-start-2 lg:row-start-3"
        }`}
      >
        <div className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">
            Your write-up
            {saveState === "saving" && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                saving
              </span>
            )}
            {saveState === "saved" && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                saved
              </span>
            )}
          </h2>
          <div className="mt-3 space-y-5">
            {sections.map((sec) => (
              <div key={sec.key}>
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {sec.label}
                  </label>
                  <DictateButton
                    onTranscript={(text) =>
                      editSection(
                        sec.key,
                        sections.find((x) => x.key === sec.key)?.body
                          ? `${sections.find((x) => x.key === sec.key)?.body}\n${text}`
                          : text,
                      )
                    }
                    onError={setSectionNote}
                  />
                </div>
                <AutoTextarea
                  value={sec.body}
                  onChange={(e) => editSection(sec.key, e.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm leading-relaxed text-zinc-100 outline-none focus:border-cyan-glow/50"
                />
              </div>
            ))}
            {sectionNote && (
              <p className="text-xs text-amber-400">{sectionNote}</p>
            )}
          </div>
        </div>

        <div className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">Attachments</h2>
          <AttachmentManager
            orderId={detail.id}
            attachments={attachments}
            onChanged={onChanged}
          />
        </div>

        {/* The write-up tools.
            Titled, and the checklist is always on: three of its lines are
            arithmetic over what the coach has already typed, so they can
            tick themselves as the writing grows. A card that is already
            doing something explains what the buttons are for better than a
            sentence would. */}
        <div className="mt-8 rounded-2xl border border-edge bg-surface p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Tools
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runTidy}
              disabled={tool !== null || ranOn.tidy === written}
              className="inline-flex items-center gap-2 rounded-xl border border-edge bg-surface-2 px-4 py-2.5 text-sm font-medium text-zinc-100 shadow-sm transition-colors hover:border-cyan-glow/50 hover:bg-surface disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-cyan-glow"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 7h16M4 12h10M4 17h7" />
              </svg>
              {tool === "tidy" ? "Tidying" : "Tidy up"}
            </button>
            {undoTo && (
              <button
                type="button"
                onClick={undoTidy}
                disabled={tool !== null}
                className="inline-flex items-center gap-2 rounded-xl border border-edge px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:text-white disabled:opacity-50"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 5 3.5 9.5 8 14M4 9.5h10a6 6 0 0 1 0 12h-3" />
                </svg>
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={runCheck}
              disabled={tool !== null || ranOn.check === written}
              className="inline-flex items-center gap-2 rounded-xl border border-edge bg-surface-2 px-4 py-2.5 text-sm font-medium text-zinc-100 shadow-sm transition-colors hover:border-cyan-glow/50 hover:bg-surface disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-cyan-glow"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 5h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
                <path d="m9.5 12.5 1.6 1.6 3.4-3.4" />
              </svg>
              {tool === "check" ? "Checking" : "Review"}
            </button>
          </div>
          {toolNote && (
            <p className="mt-3 text-xs text-zinc-500">{toolNote}</p>
          )}

          <ul className="mt-4 space-y-2 border-t border-edge/60 pt-4">
            {[
              {
                // Not every section, because not every section applies to
                // every match. An empty one simply does not appear in what
                // the student receives, so asking for all of them was
                // asking a coach to fill boxes to satisfy a tick.
                ok: sections.some((x) => x.body.trim().length > 0),
                label: "The write-up has something in it",
              },
              {
                // ONE point on ONE pattern. Nobody is being asked to tag a
                // hundred rallies, and the label used to imply they were.
                ok: findings.some(
                  (f) => (findingPoints[f.id] ?? []).length > 0,
                ),
                label: "A pattern has at least one point on it",
              },
              {
                ok:
                  sections
                    .map((x) => x.body)
                    .join(" ")
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean).length >= 120,
                label: "Long enough to feel worth the price",
              },
              ...(answered ?? []).map((a) => ({
                ok: a.covered,
                label: a.covered
                  ? `Covered ${a.question}`
                  : `Nothing yet on ${a.question}`,
              })),
            ].map((item) => (
              <li key={item.label} className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    item.ok
                      ? "bg-cyan-glow/15 text-cyan-glow"
                      : "border border-edge text-zinc-600"
                  }`}
                >
                  {item.ok && (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-2.5 w-2.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.5"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m5 13 4 4 10-10"
                      />
                    </svg>
                  )}
                </span>
                <span
                  className={`text-xs leading-relaxed ${
                    item.ok ? "text-zinc-400" : "text-zinc-300"
                  }`}
                >
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-10 rounded-2xl border border-edge bg-surface p-5">
          {confirmDeliver ? (
            <>
              <p className="text-sm text-zinc-300">
                Deliver this review to {detail.student_name}? It locks when it
                ships.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={deliver}
                  disabled={busy}
                  className="glow-cta flex-1 rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  {busy ? "Delivering" : "Deliver"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeliver(false)}
                  className="rounded-full border border-edge px-5 py-3 text-sm font-medium text-zinc-400"
                >
                  Not yet
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDeliver(true)}
              disabled={!canDeliver}
              className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
            >
              Deliver the review
            </button>
          )}
          {blocker && (
            <p className="mt-3 text-center text-sm text-zinc-500">{blocker}</p>
          )}
        </div>
      </div>
    </>
  );
}

function AttachmentManager({
  orderId,
  attachments,
  onChanged,
}: {
  orderId: string;
  attachments: ReviewAttachmentRow[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setNote(null);
    try {
      const createRes = await fetch("/api/review-attachment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          orderId,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      const created = (await createRes.json()) as {
        url?: string;
        key?: string;
        code?: string;
      };
      if (!createRes.ok || !created.url || !created.key) {
        setNote(
          created.code === "unsupported_type"
            ? "That file type isn't supported."
            : created.code === "too_large"
              ? "Files are limited to 50 MB."
              : "Could not upload. Try again.",
        );
        return;
      }
      const put = await fetch(created.url, { method: "PUT", body: file });
      if (!put.ok) {
        setNote("Could not upload. Try again.");
        return;
      }
      const doneRes = await fetch("/api/review-attachment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          orderId,
          key: created.key,
          filename: file.name,
          contentType: file.type,
        }),
      });
      if (!doneRes.ok) {
        setNote("Could not upload. Try again.");
        return;
      }
      onChanged();
    } catch {
      // Most likely the storage PUT itself (network or CORS).
      setNote("Could not upload. Try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: string) {
    await createClient().from("review_attachments").delete().eq("id", id);
    onChanged();
  }

  return (
    <div className="mt-3">
      {attachments.length > 0 && (
        <div className="mb-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 px-5 py-3.5"
            >
              <span className="truncate text-sm text-zinc-200">
                {a.filename}
              </span>
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="shrink-0 text-sm text-zinc-400 hover:text-amber-400"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.mp4,.mov,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="rounded-full border border-edge bg-surface px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 disabled:opacity-60"
      >
        {busy ? "Uploading" : "Add a file"}
      </button>
      <span className="ml-3 text-xs text-zinc-600">
        A practice plan, a drill sheet, anything up to 50 MB.
      </span>
      {note && <p className="mt-2 text-xs text-amber-400">{note}</p>}
    </div>
  );
}

/**
 * The student's note about this review, with the one decision that
 * matters: whether it appears on your page. Editing on their side
 * un-features it, so what shows is always words you approved.
 */
function TestimonialReceived({
  detail,
  onChanged,
}: {
  detail: ReviewOrderDetail;
  onChanged: () => void;
}) {
  const [featured, setFeatured] = useState(detail.testimonial_featured);
  async function toggle(next: boolean) {
    setFeatured(next);
    const { error } = await createClient().rpc("feature_review_testimonial", {
      p_order_id: detail.id,
      p_featured: next,
    });
    if (error) setFeatured(!next);
    else onChanged();
  }
  return (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        From {detail.student_name}
      </h2>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
        {detail.testimonial}
      </p>
      <label className="mt-4 flex cursor-pointer items-center justify-between text-sm">
        <span className="font-medium text-zinc-200">Show on your page</span>
        <input
          type="checkbox"
          checked={featured}
          onChange={(e) => void toggle(e.target.checked)}
          className="h-5 w-9 cursor-pointer appearance-none rounded-full bg-surface-2 outline outline-1 outline-edge transition-colors checked:bg-cyan-glow/80 before:mt-0.5 before:ml-0.5 before:block before:h-4 before:w-4 before:rounded-full before:bg-zinc-400 before:transition-transform checked:before:translate-x-4 checked:before:bg-ink"
        />
      </label>
    </div>
  );
}

/** One tap, one email, once: their inbox gets a nudge to book again. */
function InviteBack({
  detail,
  onChanged,
}: {
  detail: ReviewOrderDetail;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (detail.invited_back_at) {
    return (
      <p className="mt-4 text-sm text-zinc-500">
        You invited them back. They got an email.
      </p>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/reviews/transition", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderId: detail.id, action: "invite_back" }),
        }).catch(() => null);
        setBusy(false);
        if (res?.ok) onChanged();
      }}
      className="mt-4 rounded-full border border-cyan-glow/40 px-5 py-2.5 text-sm font-medium text-cyan-glow transition-colors hover:bg-cyan-glow/10 disabled:opacity-60"
    >
      {busy ? "Sending" : "Invite them back"}
    </button>
  );
}
