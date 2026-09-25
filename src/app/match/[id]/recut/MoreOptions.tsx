"use client";

/**
 * More options: the Tools row that took the place of "Processing" on a
 * processed match (Cut again, 2026-09-25), and the sheet it opens.
 *
 *   PROCESS AGAIN                        a section label over the two ways
 *   (o) Automatically            12 min  one pick-one group (WayChoice)
 *   ( ) Mark the points yourself 14 marked
 *   the selected way's content:          Automatically: the raw page's
 *                                        trim and strictness, the choice,
 *                                        then Process again. By hand: the
 *                                        raw page's switch and Start
 *                                        marking, into the marker on the
 *                                        ORIGINAL, prefilled from this cut
 *
 *   Report a problem                     its own group, no label; today's
 *                                        request form, unchanged
 *
 * The group and both contents are the raw page's own components
 * (BreakIntoPoints), so the two places look and behave the same. With only
 * one way on offer there is no group, just that way's content. At the last
 * step of either the
 * player picks Replace this match or Keep this match and add a new one
 * (RecutChoice). Replace builds the new cut beside this one; the match
 * keeps playing and this row shows the ordinary progress until the new cut
 * is live. Keep makes a new match and opens it.
 *
 * The database calls are the contract's (2026-09-25-cut-again-contract.md):
 * recut_options, start_recut, claim_hand_recut, copy_match_for_recut, and
 * claim_auto_recut for Replace under Automatically (phase 2).
 * Until they exist, recut_options fails, and the sheet offers only Report
 * a problem: nothing here can start a cut the database cannot take.
 *
 * Rendered once (Tools is not in a dual layout); the sheet portals, and so
 * does the marker, which is a full-screen takeover.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "@/components/BottomSheet";
import { SectionHeading } from "@/components/SectionHeading";
import { availabilityNotice, processingContext, serviceLane } from "@/lib/processingAvailability";
import { feedbackForJob, onDevice, processingStageLabel } from "@/lib/processingFeedback";
import { tracksServe } from "@/lib/matchTitle";
import { createClient } from "@/lib/supabase/client";
import type { Match } from "@/lib/types";
import { useProcessingFeedback } from "@/lib/useProcessingFeedback";
import { useProcessingService } from "@/lib/useProcessingService";
import {
  AutoProcessPanel,
  MarkYourselfPanel,
  ProcessingProgress,
  WayChoice,
  postProcess,
  useProcessQuote,
} from "../BreakIntoPoints";
import { ClipPlayer } from "../ClipPlayer";
import { MarkPoints } from "../MarkPoints";
import { useMatchIssueRow } from "../feedback/MatchFeedback";
import { openingMode, submittable, type CutMode, type Mark } from "../handCut";
import { TOOL_ROW_CLASS, ToolRowChevron } from "../ReelBar";
import type { MatchServer } from "../serving";
import { userFirstServerUpdate } from "../matchStructure";
import { useHandCutDraft } from "../useHandCutDraft";
import { RecutChoice } from "./RecutChoice";
import {
  autoRecutClaimError,
  moreOptionsView,
  processErrorMessage,
  readCopiedMatchId,
  readRecutClaim,
  readRecutOptions,
  recutChoiceView,
  recutClaimError,
  recutStartMode,
  unsentMarkCount,
  wayChoiceView,
  type RecutChoice as Choice,
  type RecutOptions,
  type RecutWay,
} from "./recutView";

interface RunningJob {
  id: string;
  status: string;
  progress: number | null;
  kind: string | null;
}

/** The kinds that make a match's cut. A running one means nothing else
 *  can start, and its progress is what the row shows. */
const CUT_KINDS = ["hand_cut", "deadspace_cut", "match_reprocess"];

export function MoreOptions({
  match,
  userId,
  commerceEnabled,
  hasOriginal,
  anyCalled,
  disabled = false,
}: {
  match: Match;
  userId: string;
  commerceEnabled: boolean;
  /** The original upload is still stored (matches.raw_path). */
  hasOriginal: boolean;
  /** Any visible point of this cut has a winner or a let. */
  anyCalled: boolean;
  /** The sample match: the row is shown greyed and does nothing. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const live = !disabled;
  const issue = useMatchIssueRow({
    matchId: match.id,
    isOwner: true,
    matchStatus: match.status,
    activeVersionId: match.active_processing_version_id,
  });

  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<RecutOptions | null>(null);
  const [handCutEnabled, setHandCutEnabled] = useState(false);
  const [minutesBalance, setMinutesBalance] = useState<number | null>(null);
  const [job, setJob] = useState<RunningJob | null>(null);
  const draft = useHandCutDraft(match.id, userId, live);
  const loadDraft = draft.load;

  const loadOptions = useCallback(async () => {
    const { data, error } = await createClient().rpc("recut_options", { p_match_id: match.id });
    setOptions(error ? null : readRecutOptions(data));
  }, [match.id]);

  const loadJob = useCallback(async (): Promise<RunningJob | null> => {
    const { data } = await createClient()
      .from("jobs")
      .select("id, status, progress, kind, created_at")
      .filter("options->>match_id", "eq", match.id)
      .in("kind", CUT_KINDS)
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: false })
      .limit(1);
    const row = ((data ?? []) as RunningJob[])[0] ?? null;
    setJob(row);
    return row;
  }, [match.id]);

  // What the row needs at first paint: whether a cut is running on this
  // match, and what may be offered. Both again whenever the sheet opens.
  useEffect(() => {
    if (!live) return;
    void loadOptions();
    void loadJob();
    void createClient()
      .rpc("hand_cut_enabled", { p_user: userId })
      .then(({ data }) => setHandCutEnabled(data === true));
  }, [live, loadOptions, loadJob, userId]);

  // A running cut is polled until it ends. Done means a new cut went live
  // (or a new match was made): the page reloads onto it. Failed leaves the
  // match as it was; the bell says so, and a hand cut's marks come back.
  const jobId = job?.id;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || (jobStatus !== "queued" && jobStatus !== "processing")) return;
    let active = true;
    const supabase = createClient();
    const tick = async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, status, progress, kind")
        .eq("id", jobId)
        .maybeSingle();
      if (!active || !data) return;
      const row = data as RunningJob;
      if (row.status === "done" || row.status === "failed") {
        setJob(null);
        void loadOptions();
        void loadDraft();
        router.refresh();
      } else setJob(row);
    };
    const timer = setInterval(() => void tick(), 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobId, jobStatus, loadOptions, loadDraft, router]);

  const feedbackByMatch = useProcessingFeedback(live ? [match.id] : []);
  // About the running cut, never the finished one before it: a Replace
  // just asked for reads "Waiting to prepare clips", as the unprocessed
  // page reads it, not a bare "Processing" until the next poll.
  const feedback = feedbackForJob(feedbackByMatch[match.id] ?? null, job);
  const services = useProcessingService();
  const running = job != null;
  const stageLabel = running ? processingStageLabel(feedback) : null;
  const serviceState = services[feedback?.lane ?? serviceLane(feedback?.job_kind ?? job?.kind)];
  // A re-cut running here is the player's own Replace (support's never
  // reaches this feed), and it ends in the ordinary ready email, as a
  // processed upload does.
  const runningKind = feedback?.job_kind ?? job?.kind;
  const availabilityContext = processingContext(
    runningKind === "match_reprocess" ? "deadspace_cut" : runningKind,
    true,
  );
  const serviceNotice = onDevice(feedback) ? null : availabilityNotice(serviceState, availabilityContext);

  const view = moreOptionsView({
    options,
    handCutEnabled: handCutEnabled && draft.ready,
    commerceEnabled,
    hasOriginal,
    jobRunning: running,
  });
  /** Either way is on offer: the "Process again" group shows. */
  const processRows = view.automatic || view.hand;

  /* ------------------------------------------------ the original, shown */

  /**
   * The original upload, signed once and held: the preview above the trim
   * bar reads it, and the marker opens on it. A fresh signature on every
   * render would reload the player mid-session (RawMatchView explains).
   */
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [rawMissing, setRawMissing] = useState(false);
  const rawRequest = useRef<Promise<string | null> | null>(null);
  const originalUrl = useCallback(async (): Promise<string | null> => {
    if (rawUrl) return rawUrl;
    rawRequest.current ??= fetch("/api/media-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId: match.id, rawPreview: true }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (typeof data?.url === "string" ? data.url : null))
      .catch(() => null);
    const url = await rawRequest.current;
    rawRequest.current = null;
    if (url) setRawUrl(url);
    else setRawMissing(true);
    return url;
  }, [match.id, rawUrl]);

  /* ------------------------------------------------------- Automatically */

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const quote = useProcessQuote({
    durationS: match.duration_s ?? null,
    minutesBalance,
    videoRef: previewRef,
  });
  const [autoPick, setAutoPick] = useState<Choice | null>(null);
  const autoChoice = recutChoiceView("automatic", options, autoPick);
  const [busy, setBusy] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  /** A copy made for "Keep" whose processing was refused (a full queue,
   *  say): the retry processes the same copy rather than making another. */
  const copyId = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !live) return;
    void loadOptions();
    void loadJob();
    void createClient()
      .rpc("my_processing_state")
      .single()
      .then(({ data }) => {
        const state = data as { minutes_balance?: number } | null;
        if (typeof state?.minutes_balance === "number") setMinutesBalance(state.minutes_balance);
      });
  }, [open, live, loadOptions, loadJob]);


  const processAutomatically = async () => {
    if (busy || quote.charge == null) return;
    setBusy(true);
    setAutoError(null);
    try {
      if (autoChoice.selected === "replace") {
        // claim_auto_recut (phase 2): the candidate is built beside this cut
        // and charged as /api/process charges (the same window, strictness
        // and minutes; it always asks for the detailed analysis, as
        // request() does). Greyed until recut_options says
        // replace_automatic.
        const req = quote.request();
        const { data, error } = await createClient().rpc("claim_auto_recut", {
          p_match_id: match.id,
          p_replace: true,
          p_trim_start_s: req.trimStartS,
          p_trim_end_s: req.trimEndS,
          p_strictness: req.strictness,
        });
        if (error) {
          const refused = autoRecutClaimError(error.message);
          if (refused.code === "coach_review") {
            setAutoPick("keep");
            await loadOptions();
          } else {
            if (refused.code === "insufficient_minutes") quote.setMinutesShort(true);
            setAutoError(refused.text);
            if (refused.code !== "insufficient_minutes" && refused.code !== "queue_full") {
              await loadOptions();
            }
          }
          return;
        }
        const claim = readRecutClaim(data);
        setJob({ id: claim?.jobId ?? "pending", status: "queued", progress: 0, kind: "match_reprocess" });
        setOpen(false);
        return;
      }
      let target = copyId.current;
      if (!target) {
        const { data, error } = await createClient().rpc("copy_match_for_recut", { p_match_id: match.id });
        if (error) {
          setAutoError(recutClaimError(error.message).text);
          await loadOptions();
          return;
        }
        target = readCopiedMatchId(data);
        if (!target) {
          setAutoError("Something went wrong. Try again.");
          return;
        }
        copyId.current = target;
      }
      const res = await postProcess(target, quote.request());
      if (!res.ok) {
        if (res.code === "insufficient_minutes") quote.setMinutesShort(true);
        setAutoError(processErrorMessage(res.code));
        return;
      }
      router.push(`/match/${target}`);
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------- Mark the points yourself */

  const [handPick, setHandPick] = useState<Choice | null>(null);
  const handChoice = recutChoiceView("hand", options, handPick);
  const handChoiceRef = useRef(handChoice.selected);
  handChoiceRef.current = handChoice.selected;
  const [handError, setHandError] = useState<string | null>(null);
  const scoringAllowed = tracksServe(match.match_type);
  const [modeChoice, setModeChoice] = useState<CutMode | null>(null);
  const markMode: CutMode = !scoringAllowed
    ? "cut"
    : modeChoice ??
      recutStartMode({
        draftMarks: draft.marks,
        draftMode: draft.mode,
        draftSubmitted: draft.submitted,
        anyCalled,
        scoringAllowed,
      });
  const unsent = unsentMarkCount(draft.marks, draft.submitted, draft.prefilled);

  /** The way the player picked, if any; until then wayChoiceView selects
   *  Automatically, or Mark the points yourself when the row reads
   *  "{N} marked". Local state only. */
  const [pickedWay, setPickedWay] = useState<RecutWay | null>(null);
  // No original to mark on: the hand row greys and cannot be picked, as
  // on the unprocessed page. (A match with no stored original never gets
  // here: moreOptionsView says so in place of both rows.)
  const ways = wayChoiceView({
    automatic: view.automatic,
    hand: view.hand,
    handDisabled: rawMissing,
    markedCount: unsent,
    picked: pickedWay,
  });

  // The trim's preview reads the original, so it is signed as soon as
  // Automatically shows in an open sheet.
  useEffect(() => {
    if (ways.selected === "automatic" && open && live) void originalUrl();
  }, [ways.selected, open, live, originalUrl]);

  const [opening, setOpening] = useState(false);
  const [marking, setMarking] = useState<{
    url: string;
    marks: Mark[];
    mode: CutMode;
  } | null>(null);
  const [firstServer, setFirstServer] = useState<MatchServer | null>(
    (match.first_server as MatchServer | null) ?? null,
  );

  /**
   * Into the marker on the original: start_recut writes the draft from
   * this cut's points (or hands back the unsent one), and the marker opens
   * on exactly that, with its stamp, so every save after is a conditional
   * update of the row.
   */
  const startMarking = async () => {
    if (opening) return;
    setOpening(true);
    setHandError(null);
    try {
      const [url, recut] = await Promise.all([
        originalUrl(),
        createClient().rpc("start_recut", { p_match_id: match.id, p_fresh: false }),
      ]);
      if (recut.error) {
        setHandError(recutClaimError(recut.error.message).text);
        await loadOptions();
        return;
      }
      if (!url) {
        setHandError("The original video is no longer stored.");
        return;
      }
      const row = (Array.isArray(recut.data) ? recut.data[0] : recut.data) as {
        marks?: unknown;
        mode?: unknown;
        updated_at?: string | null;
      } | null;
      const marks = draft.adopt(row?.marks, row?.mode, row?.updated_at ?? null);
      draft.beginSession();
      const recorded = row?.mode === "cut" || row?.mode === "score" ? row.mode : null;
      setOpen(false);
      setMarking({
        url,
        marks,
        mode: !scoringAllowed ? "cut" : modeChoice ?? openingMode(marks, recorded, true),
      });
    } finally {
      setOpening(false);
    }
  };

  const saveFirstServer = useCallback(
    async (value: MatchServer) => {
      const prev = firstServer;
      setFirstServer(value);
      const { error } = await createClient()
        .from("matches")
        .update(userFirstServerUpdate(value))
        .eq("id", match.id);
      if (error) setFirstServer(prev);
    },
    [firstServer, match.id],
  );

  const submitRecut = useCallback(
    async (marks: Mark[]): Promise<string | null> => {
      const replace = handChoiceRef.current === "replace";
      const { data, error } = await createClient().rpc("claim_hand_recut", {
        p_match_id: match.id,
        p_marks: submittable(marks),
        p_replace: replace,
      });
      if (error) {
        const refused = recutClaimError(error.message);
        if (refused.code === "coach_review") {
          // Not an error to show: Replace greys out with its reason and
          // the choice is back on Keep, for the player to send again.
          setHandPick("keep");
          await loadOptions();
          return "";
        }
        return refused.text;
      }
      const claim = readRecutClaim(data);
      if (!replace && claim && claim.matchId !== match.id) {
        router.push(`/match/${claim.matchId}`);
        return null;
      }
      setJob({ id: claim?.jobId ?? "pending", status: "queued", progress: 0, kind: "hand_cut" });
      void loadJob();
      return null;
    },
    [match.id, loadOptions, loadJob, router],
  );

  /* ------------------------------------------------------------- render */

  const trailing = running ? (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-cyan-glow/30 border-t-cyan-glow"
      />
      <span aria-live="polite" className="truncate text-xs text-zinc-400">
        {stageLabel ?? "Processing"}
      </span>
    </span>
  ) : issue.requestStatus ? (
    <span className="truncate text-xs text-zinc-500">{issue.requestStatus}</span>
  ) : null;

  const picture = (
    <OriginalPreview
      url={rawUrl}
      missing={rawMissing}
      videoRef={previewRef}
      onDuration={quote.learnDuration}
    />
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={TOOL_ROW_CLASS}
      >
        <span className="shrink-0 text-sm font-semibold">More options</span>
        <span className="flex min-w-0 items-center gap-2">
          {trailing}
          <ToolRowChevron />
        </span>
      </button>

      <BottomSheet
        open={open && live}
        portal
        title="More options"
        onClose={() => setOpen(false)}
        widthClass="sm:max-w-md"
      >
        {view.running && (
          <ProcessingProgress
            className="mt-4"
            serviceNotice={!!serviceNotice}
            serviceState={serviceState}
            availabilityContext={availabilityContext}
            label={stageLabel}
            progress={job?.progress ?? null}
            estimate={feedback?.estimate}
            jobStatus={feedback?.job_status ?? job?.status ?? null}
          />
        )}
        {view.note && <p className="mt-4 text-sm text-zinc-400">{view.note}</p>}
        {/* What the two ways do to a processed match, said once as a label
            in the page's own section style (Adil, 2026-09-25), not as a
            sentence under the title. The label covers these two rows
            only; Report a problem is a group of its own below. */}
        {processRows && (
          <>
            <SectionHeading className="mt-5">Process again</SectionHeading>
            {/* One pick-one group, then only the selected way's content,
                as on the unprocessed page (Adil, 2026-09-25, option A).
                Each way ends in one cyan button, so exactly one shows. */}
            {ways.group && ways.selected && (
              <WayChoice
                className="mt-3"
                label="Process again"
                selected={ways.selected}
                onSelect={setPickedWay}
                trailing={{
                  automatic: quote.charge != null ? `${quote.charge} min` : null,
                  hand: unsent > 0 ? `${unsent} marked` : null,
                }}
                handDisabled={rawMissing}
              />
            )}
            {ways.selected === "automatic" && (
              <AutoProcessPanel
                className="mt-5"
                quote={quote}
                onProcess={() => void processAutomatically()}
                actionLabel="Process again"
                busy={busy}
                error={autoError}
                picture={picture}
                choice={
                  <RecutChoice
                    name="recut-automatic"
                    view={autoChoice}
                    onChange={setAutoPick}
                    disabled={busy}
                  />
                }
                onBalanceChecked={() => setAutoError(null)}
              />
            )}
            {ways.selected === "hand" && (
              <>
                <MarkYourselfPanel
                  className="mt-5"
                  mode={markMode}
                  scoringAllowed={scoringAllowed}
                  onMode={setModeChoice}
                  resume={unsent > 0}
                  opening={opening}
                  onStart={() => void startMarking()}
                />
                {handError && (
                  <p className="mt-3 text-sm text-amber-300/90">{handError}</p>
                )}
              </>
            )}
          </>
        )}
        {/* Report a problem stands apart from Process again, as on iOS,
            where it is its own Form section: the gap is the one iOS
            leaves between sections (about 35pt), and there is no label
            over it. Alone in the sheet, it reads as it always has. */}
        <div
          className={`-mx-5 border-t border-edge/60 ${
            processRows ? "mt-9 border-b" : "mt-4"
          }`}
        >
          <Link
            href={`/match/${match.id}/feedback`}
            className="flex w-full items-center gap-3 p-5 text-left transition-colors hover:bg-ink/20"
          >
            <span className="min-w-0 flex-1 text-sm font-semibold text-zinc-100">
              Report a problem
            </span>
            {issue.requestStatus && (
              <span className="shrink-0 text-xs text-zinc-500">{issue.requestStatus}</span>
            )}
            <ToolRowChevron />
          </Link>
        </div>
      </BottomSheet>

      {marking &&
        typeof document !== "undefined" &&
        createPortal(
          <MarkPoints
            rawUrl={marking.url}
            durationS={quote.duration}
            firstServer={firstServer}
            matchType={match.match_type}
            onFirstServer={saveFirstServer}
            youLabel="Me"
            themLabel={((match.opponent_name ?? "").trim().split(/\s+/)[0] || "Them").slice(0, 12)}
            initialMarks={marking.marks}
            startMode={marking.mode}
            onModeChange={(mode) => {
              if (scoringAllowed) setModeChoice(mode);
            }}
            saveDraft={draft.save}
            submit={submitRecut}
            canStartAgain
            reviewChoice={
              <RecutChoice name="recut-hand" view={handChoice} onChange={setHandPick} />
            }
            onClose={() => setMarking(null)}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * The original upload inside the sheet, above the trim bar, so the trim's
 * handles and "Start here" / "End here" have a picture to point at, as they
 * do on the unprocessed page. Paused when it leaves the page: a removed
 * <video> keeps playing with sound.
 */
function OriginalPreview({
  url,
  missing,
  videoRef,
  onDuration,
}: {
  url: string | null;
  missing: boolean;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  onDuration: (d: number) => void;
}) {
  const el = useRef<HTMLVideoElement | null>(null);
  useEffect(() => () => el.current?.pause(), []);
  if (missing) {
    return <p className="mb-5 text-sm text-zinc-400">The original video is no longer stored.</p>;
  }
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-edge bg-black">
      {url ? (
        <ClipPlayer
          src={url}
          mode="cut"
          readPixels={false}
          videoElRef={videoRef}
          onLoadedMetadata={(v) => {
            el.current = v;
            if (Number.isFinite(v.duration) && v.duration > 0) onDuration(v.duration);
          }}
        />
      ) : (
        <div className="aspect-video w-full animate-pulse bg-surface-2" />
      )}
    </div>
  );
}
