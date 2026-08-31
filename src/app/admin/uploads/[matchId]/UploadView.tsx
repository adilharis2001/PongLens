"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Point } from "@/lib/types";
import {
  effectiveEnd,
  paddedEnd,
  type ClipPad,
  type EndOptions,
} from "../../../match/[id]/playhead";
import { clipPad, effectivePad } from "../../../match/[id]/clipEdit";
import { computeServing, type ServeInfo } from "../../../match/[id]/serving";
import {
  buildPointRows,
  formatClock,
  fpsLabel,
  gapLabel,
  gbLabel,
  pointFlags,
  readAssembly,
  readTable,
  retentionPct,
  routeExplanation,
  timelineSegments,
  timelineSummary,
  troubleLines,
  whenLabel,
  type MatchJson,
  type UploadDetail,
  type UploadPointRow,
} from "../uploadView";
import type { CardReading, ReadingSummary } from "../pointReadings";
import {
  cutOffsetFor,
  missForPoint,
  reasonShort,
  reasonTally,
  reasonTone,
  refusedCards,
  type ServeMissData,
} from "../serveMiss";
import { CardFacts } from "./CardFacts";
import { CardReview, type Theme } from "./CardReview";
import { PointCard } from "./PointCard";
import { ServeMissView } from "./ServeMissView";
import { TableQuad } from "./TableQuad";
import { UploadTape } from "./UploadTape";

/** Sentinel for "the tape is showing the original, not a card". */
const RAW_TAPE = "__raw__";

/**
 * lg and up gets the side-by-side.
 *
 * matchMedia in state rather than a Tailwind `lg:hidden` twin, so only ONE
 * branch is ever mounted. Rendering both and hiding one with display:none
 * is the trap this codebase keeps falling into: the hidden branch still
 * runs, and its <video> still plays. Same approach as MatchView.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/**
 * One upload, opened up.
 *
 * The page answers three questions in the order they get asked: what did
 * the pipeline think the table was, how did it decide to cut the cards, and
 * what did the player end up with. The cards are last because they are the
 * long part — everything above them fits over the fold on a 393x660 phone,
 * and the list scrolls under it.
 *
 * There is no nested scroll box. The old breakdown put the points inside a
 * max-h-80 overflow-y-auto list whose rows were 590px wide inside a 393px
 * screen, so the Play button sat off the side of the phone entirely. One
 * page scroll, full-width rows, and the only tap target on a card is the
 * card.
 */

export function UploadView({
  detail,
  matchJson,
  serveMisses,
  readings,
  readingSummary,
  themes: initialThemes,
  ends,
}: {
  detail: UploadDetail;
  matchJson: MatchJson | null;
  serveMisses: ServeMissData | null;
  readings: CardReading[];
  readingSummary: ReadingSummary | null;
  themes: Theme[];
  ends: EndOptions;
}) {
  const { match, owner, job, totals } = detail;

  const [cutUrl, setCutUrl] = useState<string | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [tapeAt, setTapeAt] = useState<string | null>(null);
  const [tapeSource, setTapeSource] = useState<"cut" | "raw">("cut");
  // Desktop selects a card into a pane beside the list; a phone opens the
  // takeover. Nothing else changes between them.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
  // The pane scrolls itself now, so a card picked while it was scrolled
  // down would open halfway through its own analysis.
  const paneRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  // The operator's review, held here rather than inside each card so the
  // pane and the list agree the moment either changes, and so a theme
  // created on card 40 is offered on card 41 without a reload.
  const [vocabulary, setVocabulary] = useState<Theme[]>(initialThemes);
  const [reviewNotes, setReviewNotes] = useState<Map<string, string>>(
    () => new Map(detail.points.map((p) => [p.id, p.admin_note ?? ""]))
  );
  const [reviewThemes, setReviewThemes] = useState<Map<string, string[]>>(
    () => new Map(detail.points.map((p) => [p.id, p.admin_theme_ids ?? []]))
  );

  const setNote = useCallback((pointId: string, body: string) => {
    setReviewNotes((m) => new Map(m).set(pointId, body));
  }, []);
  const toggleTheme = useCallback(
    (pointId: string, themeId: string, on: boolean) => {
      setReviewThemes((m) => {
        const next = new Map(m);
        const cur = next.get(pointId) ?? [];
        next.set(
          pointId,
          on ? [...cur, themeId] : cur.filter((id) => id !== themeId)
        );
        return next;
      });
    },
    []
  );
  const addTheme = useCallback((theme: Theme) => {
    setVocabulary((v) =>
      v.some((t) => t.id === theme.id) ? v : [...v, theme]
    );
  }, []);

  const reviewFor = (pointId: string) => ({
    note: reviewNotes.get(pointId) ?? "",
    themeIds: reviewThemes.get(pointId) ?? [],
  });

  const rows = useMemo(() => buildPointRows(detail.points), [detail.points]);
  const readingFor = useMemo(
    () => new Map(readings.map((r) => [r.pointId, r])),
    [readings]
  );
  const table = useMemo(
    () => readTable(matchJson, match.story_crop),
    [matchJson, match.story_crop]
  );
  const assembly = useMemo(() => readAssembly(matchJson), [matchJson]);
  const trouble = useMemo(() => troubleLines(detail), [detail]);

  // The pads a clip was ACTUALLY cut with. matches.clip_pads is the
  // authority since 048; the strictness table is only the frozen fallback
  // for older matches.
  const pad = useMemo(
    () => clipPad(job?.strictness, match.clip_pads),
    [job?.strictness, match.clip_pads]
  );

  // The serve rotation, computed exactly as the owner's page computes it:
  // over the VISIBLE timeline, from matches.first_server.
  const serving = useMemo(() => {
    const visible = rows.filter((r) => !r.deleted);
    return computeServing(
      visible as unknown as Point[],
      match.first_server ?? null
    );
  }, [rows, match.first_server]);

  const signCut = useCallback(async () => {
    const res = await fetch("/api/admin/media-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId: match.id }),
    });
    const body = (await res.json()) as { url?: string };
    return res.ok && body.url ? body.url : null;
  }, [match.id]);

  // Signed once on mount: the same URL is the frame under the table
  // drawing and the tape's video, so a second signature would buy nothing.
  //
  // With no cut, the ORIGINAL stands in. An upload that never finished
  // processing is exactly the one an admin wants to look at, and telling
  // them there is no video when the file is sitting in R2 is a worse
  // answer than one presign.
  useEffect(() => {
    let live = true;
    if (match.has_cut) {
      void signCut().then((url) => {
        if (live) setCutUrl(url);
      });
    } else if (match.raw_available) {
      void fetch("/api/admin/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id, raw: true }),
      })
        .then((res) => res.json() as Promise<{ url?: string }>)
        .then((body) => {
          if (live && body.url) setRawUrl(body.url);
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [match.has_cut, match.raw_available, match.id, signCut]);

  const openRaw = async () => {
    if (rawUrl) {
      setTapeSource("raw");
      setTapeAt(RAW_TAPE);
      return;
    }
    setLoadingRaw(true);
    setRawError(null);
    try {
      // `raw` must travel WITHOUT a pointId: the route dispatches pointId
      // first and would quietly hand back a clip instead.
      const res = await fetch("/api/admin/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id, raw: true }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setRawError(body.error ?? "Could not load the original.");
        return;
      }
      setRawUrl(body.url);
      setTapeSource("raw");
      setTapeAt(RAW_TAPE);
    } catch {
      setRawError("Could not load the original.");
    } finally {
      setLoadingRaw(false);
    }
  };

  const openCutAt = (pointId: string) => {
    setTapeSource("cut");
    setTapeAt(pointId);
  };

  // One tap, two meanings by width. On a phone the screen is too small to
  // hold a list and a player at once, so a card opens the takeover. On a
  // laptop there is room for both and losing the list to a full-screen
  // player every time you check a card is the wrong trade — the whole
  // point of the page is comparing cards.
  const pickCard = (pointId: string) => {
    if (isDesktop) setSelectedId(pointId);
    else openCutAt(pointId);
  };

  // Park the still frame inside the first rally rather than at zero, where
  // a match that opens on an empty hall shows no table at all.
  const firstWithCut = rows.find((r) => !r.deleted && r.cut_t0 !== null);
  const seekS = firstWithCut
    ? Number(firstWithCut.cut_t0) +
      effectivePad(pad, firstWithCut.tight_start, firstWithCut.tight_end).pre +
      0.5
    : 0.1;

  // First names where we have them; the two ends of the table otherwise.
  // "Near"/"Far" is not a fallback worth reaching for — it names a camera
  // position, not a person.
  const names = {
    user:
      match.player_near_name ||
      (owner?.name || "").split(" ")[0] ||
      "The player",
    opponent: match.player_far_name || match.opponent_name || "Their opponent",
  };

  const src = matchJson?.source;
  const fps = fpsLabel(src?.fps);
  const retention = retentionPct(totals.src_duration_s, totals.cut_duration_s);
  const playable = rows.filter((r) => r.cut_t0 !== null);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 lg:max-w-none lg:px-8">
      {/* Who and what */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/players/${match.user_id}`}
            className="text-sm text-zinc-400 transition-colors hover:text-white"
          >
            ← {owner?.name || owner?.email || "Player"}
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold">
            {match.opponent_name || "Match"}
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {[
              whenLabel(match.played_at ?? match.created_at),
              match.venue,
              match.match_type,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => void openRaw()}
            disabled={loadingRaw || !match.raw_available}
            className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
          >
            {loadingRaw ? "Loading…" : "Original"}
          </button>
        </div>
      </div>
      {!match.raw_available && (
        <p className="mt-2 text-sm text-zinc-500">
          The original is gone. Uploads are kept thirty days.
        </p>
      )}
      {rawError && <p className="mt-2 text-sm text-amber-300">{rawError}</p>}

      {/* What went wrong, if anything */}
      {trouble.map((t) => (
        <div
          key={t.title}
          className={`mt-4 rounded-2xl border p-4 ${
            t.tone === "red"
              ? "border-red-400/40 bg-red-400/5"
              : "border-amber-400/40 bg-amber-400/5"
          }`}
        >
          <p
            className={`text-sm font-medium ${
              t.tone === "red" ? "text-red-300" : "text-amber-300"
            }`}
          >
            {t.title}
          </p>
          {t.detail && (
            <p className="mt-1 text-sm text-zinc-400">{t.detail}</p>
          )}
        </div>
      ))}

      {/* The table. Full-bleed on a phone: a 16:9 picture on a 393px screen
          is 221px tall, and giving up the page padding is 32px of it. */}
      <div className="-mx-4 sm:mx-0">
        <TableQuad
          table={table}
          videoUrl={cutUrl ?? rawUrl}
          seekS={cutUrl ? seekS : 0.1}
          sourceWidth={src?.width ?? null}
          sourceHeight={src?.height ?? null}
        />
      </div>

      {/* How the cards were cut */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">How this was processed</h2>
        <RouteLine assembly={assembly} processed={match.status !== "uploaded"} />

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact
            label="Card assembly"
            value={
              assembly.route === "end-on"
                ? "End-on"
                : assembly.route === "serve-anchored"
                  ? "Serve-anchored"
                  : "Not recorded"
            }
            detail={assembly.pipeline ? `pipeline ${assembly.pipeline}` : null}
          />
          <Fact
            label="Table"
            value={
              table.state === "detected"
                ? detectorName(table.detector)
                : table.state === "refused"
                  ? "None found"
                  : "Not recorded"
            }
          />
          <Fact
            label="Camera"
            value={table.camera ?? "Not computed"}
            detail={
              assembly.cameraShape != null
                ? `shape ${assembly.cameraShape.toFixed(2)}`
                : null
            }
          />
          <Fact
            label="Kept"
            value={retention != null ? `${retention}%` : "—"}
            detail={
              formatClock(totals.src_duration_s) && formatClock(totals.cut_duration_s)
                ? `${formatClock(totals.src_duration_s)} → ${formatClock(totals.cut_duration_s)}`
                : null
            }
          />
          <Fact
            label="Cards"
            value={String(totals.visible)}
            detail={
              totals.deleted > 0 ? `${totals.deleted} removed by owner` : null
            }
          />
          <Fact
            label="Scored"
            value={`${totals.scored} of ${totals.visible}`}
            detail={totals.starred > 0 ? `${totals.starred} starred` : null}
          />
          <Fact
            label="Resolution"
            value={src?.width ? `${src.width}×${src.height}` : "Not recorded"}
            detail={
              src?.duration ? `${formatClock(src.duration)} processed` : null
            }
          />
          <Fact
            label="Frame rate"
            value={fps.value}
            detail={fps.detail}
          />
          <Fact
            label="Placement"
            value={placementLabel(match.placement_status)}
            detail={
              match.placement_mapped_points
                ? `${match.placement_mapped_points} bounces mapped`
                : null
            }
          />
          <Fact
            label="Processing"
            value={
              detail.spend.minutes > 0 ? `${detail.spend.minutes} min` : "—"
            }
            detail={
              detail.spend.storage_bytes > 0
                ? gbLabel(detail.spend.storage_bytes)
                : null
            }
          />
        </dl>

        <DetectorCounts assembly={assembly} />
        <RuleScore summary={readingSummary} />

        <p className="mt-4 text-sm text-zinc-500">
          {/* Both gates fail open — a missing key, a timeout or a malformed
              reply all let a video through — so a timestamp proves a gate
              ran without refusing, and nothing stronger. */}
          {match.content_checked_at
            ? "Checked at upload and not turned away."
            : "No upload check recorded."}
          {job?.strictness ? ` Cut at ${job.strictness} strictness.` : ""}
          {matchJson?.cut_mode === "plays"
            ? " Cut on plays."
            : matchJson?.cut_mode
              ? ` Cut on ${matchJson.cut_mode}.`
              : ""}
        </p>
      </section>

      {/* The worker's own log */}
      {matchJson?.notes && matchJson.notes.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">What the pipeline said</h2>
          <ul className="mt-3 space-y-2">
            {matchJson.notes.map((note, i) => (
              <li
                key={i}
                className="rounded-xl border border-edge bg-surface px-4 py-3 text-sm text-zinc-400"
              >
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The cards */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">The cards</h2>
          {playable.length > 0 && cutUrl && (
            <button
              type="button"
              onClick={() => openCutAt(firstPlayableId(rows) ?? "")}
              className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white"
            >
              Play them through
            </button>
          )}
        </div>
        {timelineSummary(rows) && (
          <p className="mt-1 text-sm text-zinc-500">{timelineSummary(rows)}</p>
        )}

        {!serveMisses && assembly.cardsWithoutServe ? (
          <div className="mt-3 rounded-2xl border border-edge bg-surface p-4">
            <p className="text-sm text-zinc-300">
              {assembly.cardsWithoutServe} of{" "}
              {(assembly.cardsWithServe ?? 0) + assembly.cardsWithoutServe}{" "}
              cards were built without a serve, but no diagnosis has been
              generated for this upload, so there is nothing to open.
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              The per-card evidence — the ball, the bounces and the rule that
              turned each pair away — comes from a separate pass over the same
              match. Only the matches that pass has run on carry it.
            </p>
          </div>
        ) : null}

        {serveMisses && serveMisses.cards.length > 0 && (
          <div className="mt-3 rounded-2xl border border-edge bg-surface p-4">
            <p className="text-sm text-zinc-300">
              Every card carries its evidence: the ball, every bounce, and
              where the detector put the serve. Open one to check the first
              bounce and where it landed.
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              {refusedCards(serveMisses).length} of {serveMisses.cards.length}{" "}
              were built without a serve at all. A serve is accepted as a PAIR
              of bounces, so a card with none is a card where no pair passed
              the six rules.
            </p>
            {/* Two counts for one thing, a screen apart, reads as a bug —
                and here it is real, in EITHER direction. The card list
                reports what shipped; the diagnosis re-walks the same
                footage against whatever the serve rules say now, and two
                of their constants are read per job. Name both readings
                rather than letting them quietly disagree, and do not
                assume the diagnosis is the older one. */}
            {assembly.cardsWithoutServe !== null &&
              assembly.cardsWithoutServe !== refusedCards(serveMisses).length && (
                <p className="mt-2 text-sm text-amber-300">
                  Two readings disagree: the cards this match shipped with
                  carry {assembly.cardsWithoutServe} with no serve, while this
                  diagnosis, walked against today&rsquo;s rules, finds{" "}
                  {refusedCards(serveMisses).length}. Two of the serve rule&rsquo;s
                  constants are read per job, so a card can change side of the
                  line without the footage changing at all. The evidence below
                  is the current reading.
                </p>
              )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {reasonTally(refusedCards(serveMisses)).map(({ reason, count }) => (
                <span
                  key={reason}
                  className="rounded-full border px-2.5 py-0.5 text-xs"
                  style={{
                    borderColor: `${reasonTone(reason)}66`,
                    color: reasonTone(reason),
                  }}
                >
                  {count} {reasonShort(reason)}
                </span>
              ))}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
            {timelineSegments(rows).map((seg) => (
              <div
                key={seg.id}
                className={`absolute inset-y-0 ${
                  seg.deleted ? "bg-cyan-glow/25" : "bg-cyan-glow/70"
                }`}
                style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
              />
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            No cards were made from this upload.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
            {/* Each column scrolls itself on a laptop.
                The list runs to five thousand pixels on a long match, and
                a sticky pane can only pin its TOP — so the bottom of the
                pane (the map, the rules, the note box) was reachable only
                by scrolling past every card first. Capping both to the
                window below the nav and letting each scroll on its own is
                the whole fix.

                The 73px is the sticky nav's 65 plus a gap, measured, not
                guessed; the 89 is that plus the same gap at the bottom.
                Subtracting the offset a box actually has is exact — unlike
                subtracting a guess at surrounding chrome, which is the
                thing that goes wrong on a short window.

                Mobile keeps one page scroll. A nested scroll box on a
                phone is how the point list ended up unusable once before. */}
            <ul className="space-y-1.5 lg:sticky lg:top-[73px] lg:max-h-[calc(100dvh-89px)] lg:w-[19rem] lg:shrink-0 lg:overflow-y-auto lg:pr-2 xl:w-[21rem]">
              {rows.map((row) => (
                <PointCard
                  key={row.id}
                  row={row}
                  serve={serving.get(row.id) ?? null}
                  names={names}
                  pad={pad}
                  ends={ends}
                  playable={row.cut_t0 !== null && !!cutUrl}
                  selected={isDesktop && row.id === selectedId}
                  compact={isDesktop}
                  onPlay={() => pickCard(row.id)}
                  miss={missForPoint(serveMisses, row)}
                  missData={serveMisses}
                  reading={readingFor.get(row.id) ?? null}
                  cutOffset={cutOffsetFor(
                    row,
                    effectivePad(pad, row.tight_start, row.tight_end).pre
                  )}
                  videoUrl={cutUrl}
                  // The pane owns the analysis on a laptop. A card that also
                  // expanded one inside the list would put a second video of
                  // the same rally beside the first.
                  showAnalysis={!isDesktop}
                  review={reviewFor(row.id)}
                  vocabulary={vocabulary}
                  onNoteChange={setNote}
                  onThemeToggle={toggleTheme}
                  onThemeCreated={addTheme}
                />
              ))}
            </ul>

            {isDesktop && (
              <aside
                ref={paneRef}
                className="sticky top-[73px] max-h-[calc(100dvh-89px)] min-w-0 flex-1 overflow-y-auto"
              >
                <CardPane
                  row={rows.find((r) => r.id === selectedId) ?? null}
                  serve={selectedId ? serving.get(selectedId) ?? null : null}
                  names={names}
                  pad={pad}
                  ends={ends}
                  serveMisses={serveMisses}
                  reading={
                    selectedId ? readingFor.get(selectedId) ?? null : null
                  }
                  videoUrl={cutUrl}
                  onFullScreen={() => selectedId && openCutAt(selectedId)}
                  review={selectedId ? reviewFor(selectedId) : null}
                  vocabulary={vocabulary}
                  onNoteChange={setNote}
                  onThemeToggle={toggleTheme}
                  onThemeCreated={addTheme}
                />
              </aside>
            )}
          </div>
        )}
      </section>

      {tapeAt !== null && (
        <UploadTape
          rows={rows}
          startPointId={tapeAt}
          source={tapeSource}
          url={tapeSource === "raw" ? rawUrl : cutUrl}
          pad={pad}
          ends={ends}
          serving={serving}
          names={names}
          onResign={tapeSource === "cut" ? signCut : null}
          onClose={() => setTapeAt(null)}
        />
      )}
    </div>
  );
}

/** The tape opens on a card id, so "from the top" needs one too. */
/**
 * The selected card, beside the list rather than on top of it.
 *
 * Desktop only. It plays the card's own span of the cut and, where a
 * diagnosis exists, shows the same evidence the phone shows inline — so
 * the two widths differ in where the analysis sits, never in what it says.
 */
function CardPane({
  row,
  serve,
  names,
  pad,
  ends,
  serveMisses,
  reading,
  videoUrl,
  onFullScreen,
  review,
  vocabulary,
  onNoteChange,
  onThemeToggle,
  onThemeCreated,
}: {
  row: UploadPointRow | null;
  serve: ServeInfo | null;
  names: { user: string; opponent: string };
  pad: ClipPad;
  ends: EndOptions;
  serveMisses: ServeMissData | null;
  reading: CardReading | null;
  videoUrl: string | null;
  onFullScreen: () => void;
  review: { note: string; themeIds: string[] } | null;
  vocabulary: Theme[];
  onNoteChange: (pointId: string, body: string) => void;
  onThemeToggle: (pointId: string, themeId: string, on: boolean) => void;
  onThemeCreated: (theme: Theme) => void;
}) {
  if (!row) {
    return (
      <div className="rounded-2xl border border-dashed border-edge p-6">
        <p className="text-sm text-zinc-400">
          Pick a card to watch it here.
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          The list stays where it is, so you can work down it.
        </p>
      </div>
    );
  }

  const miss = missForPoint(serveMisses, row);
  const cutOffset = cutOffsetFor(
    row,
    effectivePad(pad, row.tight_start, row.tight_end).pre
  );

  return (
    <div className="rounded-2xl border border-edge bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-zinc-200">
          {row.displayNo ? `Card ${row.displayNo}` : "Removed card"}
          <span className="ml-2 font-normal tabular-nums text-zinc-500">
            {formatClock(row.t0)} → {formatClock(row.t1)}
          </span>
        </p>
        <button
          type="button"
          onClick={onFullScreen}
          className="shrink-0 rounded-full border border-edge px-3 py-1 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          Full screen
        </button>
      </div>
      {/* Everything the compact card in the list drops. It has to live
          somewhere, and beside the footage is where it can be read against
          the footage. */}
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        {serve?.server && (
          <span>
            {serve.server === "user" ? names.user : names.opponent} served
          </span>
        )}
        <span className="tabular-nums">{row.lengthS.toFixed(1)}s</span>
        {gapLabel(row.gapBeforeS) && (
          <span className="tabular-nums">{gapLabel(row.gapBeforeS)}</span>
        )}
        {row.notes > 0 && (
          <span>
            {row.notes} {row.notes === 1 ? "note" : "notes"}
          </span>
        )}
        {pointFlags(row).map((f) => (
          <span
            key={f.label}
            className={
              f.tone === "warn"
                ? "rounded border border-amber-400/40 px-1.5 py-px text-amber-300"
                : "rounded border border-edge px-1.5 py-px text-zinc-500"
            }
          >
            {f.label}
          </span>
        ))}
      </p>

      {reading && <CardFacts reading={reading} names={names} />}

      {miss && serveMisses ? (
        <ServeMissView
          data={serveMisses}
          card={miss}
          cutOffset={cutOffset ?? 0}
          videoUrl={videoUrl}
        />
      ) : (
        <PlainCardClip
          row={row}
          videoUrl={videoUrl}
          pad={pad}
          ends={ends}
        />
      )}

      {review && (
        <CardReview
          pointId={row.id}
          note={review.note}
          themeIds={review.themeIds}
          vocabulary={vocabulary}
          onNoteChange={onNoteChange}
          onThemeToggle={onThemeToggle}
          onThemeCreated={onThemeCreated}
        />
      )}
    </div>
  );
}

/**
 * A card with no diagnosis: just its footage, bounded to the card.
 *
 * Deliberately the same box and the same transport as the diagnosed view,
 * so moving down the list does not change shape under the cursor whenever
 * a card happens to carry a serve.
 */
function PlainCardClip({
  row,
  videoUrl,
  pad,
  ends,
}: {
  row: UploadPointRow;
  videoUrl: string | null;
  pad: ClipPad;
  ends: EndOptions;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const start = row.cut_t0 === null ? null : Number(row.cut_t0);
  const stop =
    effectiveEnd(row as unknown as Point, pad, ends) ??
    paddedEnd(row as unknown as Point, pad);

  useEffect(() => {
    const v = ref.current;
    if (!v || start === null) return;
    const seek = () => {
      v.currentTime = start;
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
    return () => {
      // A <video> removed from the document keeps playing, with sound.
      v.pause();
    };
  }, [start]);

  if (!videoUrl || start === null) {
    return (
      <p className="mt-3 text-sm text-zinc-500">
        This card has no place in the cut file, so there is nothing to play.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
        <video
          ref={ref}
          src={videoUrl}
          preload="metadata"
          playsInline
          controls
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (stop !== null && v.currentTime >= stop && !v.paused) {
              v.pause();
            }
          }}
          className="absolute inset-0 h-full w-full"
        />
      </div>
      <p className="mt-2 text-xs text-zinc-600">
        Stops where the player&rsquo;s own playback stops.
      </p>
    </div>
  );
}

function firstPlayableId(rows: UploadPointRow[]): string | null {
  return rows.find((r) => !r.deleted && r.cut_t0 !== null)?.id ?? null;
}

function detectorName(source: string | null): string {
  if (source === "keypoints") return "Keypoints";
  if (source === "vision") return "Vision";
  if (source === "pink_rim") return "Pink rim";
  return source ?? "Found";
}

function placementLabel(status: string | null): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "final_failed":
      return "Failed";
    case "retry_available":
      return "Can retry";
    case "not_requested":
      return "Not asked for";
    default:
      return status ?? "—";
  }
}

/** The router's decision, in the router's own terms. */
function RouteLine({
  assembly,
  processed,
}: {
  assembly: ReturnType<typeof readAssembly>;
  processed: boolean;
}) {
  const explanation = routeExplanation(assembly);
  if (!explanation) {
    return (
      <p className="mt-2 text-sm text-zinc-400">
        {!processed
          ? "Nothing has run on this upload yet."
          : assembly.fallbackReason
            ? `The serve-anchored assembler was asked for and could not run: ${assembly.fallbackReason}.`
            : "This upload predates the record of which assembler cut its cards."}
      </p>
    );
  }
  return (
    <>
      <p className="mt-2 text-sm text-zinc-300">{explanation}</p>
      {assembly.routeFrom === "inferred" && (
        <p className="mt-1 text-sm text-zinc-500">
          Read from the cards themselves — not one carries a detected serve
          — because this file has no line naming the route.
        </p>
      )}
    </>
  );
}

/**
 * What the ball detector actually handed the assembler.
 *
 * Serves and crossings are the two signals the router weighs, so they
 * belong together and next to the decision they produced. The per-card
 * split matters more than the raw serve count: 98 serves in a match is
 * only good news if they landed in 98 different cards.
 *
 * End-on gets its own line rather than a row of zeroes. Its assembler
 * never looks for a serve, so "0 serves" is its design and not a failure,
 * and reading it as a failure is the mistake this panel exists to prevent.
 */
/**
 * How the three winner rules did over this match.
 *
 * Read against the owner's own taps, and beside the worker's suggestion on
 * the same points — a rule that is right 80% of the time means nothing
 * until you know what it is beating. The per-rule split matters more than
 * the total: they run as a ladder, so the first one to answer makes the
 * call, and a rule that is often right but rarely first is a different
 * thing from one that is usually wrong.
 */
function RuleScore({ summary }: { summary: ReadingSummary | null }) {
  if (!summary || summary.points === 0) return null;
  const pct = (n: number, d: number) =>
    d === 0 ? null : Math.round((100 * n) / d);
  const mine = pct(summary.agreed, summary.compared);
  const worker = pct(summary.workerAgreed, summary.workerCompared);

  return (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-4">
      <h3 className="text-sm font-medium text-zinc-200">
        What the winner rules read
      </h3>
      {!summary.sideKnown && (
        <p className="mt-1 text-sm text-amber-300/80">
          Nobody recorded which end this player was on, so every call below
          names an END of the table rather than a person, and none of them can
          be scored against the taps.
        </p>
      )}
      <p className="mt-1 text-sm text-zinc-500">
        {summary.called} of {summary.points} cards got a call
        {summary.compared > 0 && mine !== null && (
          <>
            , and {mine}% of the {summary.compared} you had scored named the
            player you did
          </>
        )}
        {worker !== null && summary.workerCompared > 0 && (
          <>
            . The worker&rsquo;s own suggestion scores {worker}% over{" "}
            {summary.workerCompared}
          </>
        )}
        .
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {summary.byRule.map((r) => (
          <Counted
            key={r.name}
            label={r.name}
            value={r.called}
            detail={
              r.compared > 0
                ? `${pct(r.agreed, r.compared)}% right of ${r.compared}`
                : "none scored"
            }
          />
        ))}
        <Counted
          label="Rules disagreed"
          value={summary.disagreements}
          detail={
            summary.disagreements > 0 ? "two rules, two players" : null
          }
        />
        <Counted
          label="Repaired first"
          value={summary.repaired}
          detail="events the flights put back"
        />
        <Counted
          label="Median serve speed"
          value={
            summary.speeds.medianKmh !== null
              ? `${summary.speeds.medianKmh} km/h`
              : "—"
          }
          detail={
            summary.speeds.count > 0
              ? `over ${summary.speeds.count} serves, fastest ${summary.speeds.maxKmh} km/h`
              : "no serve had both its bounces"
          }
        />
      </dl>

      {summary.withTrack === 0 ? (
        <p className="mt-3 text-xs text-zinc-600">
          No usable ball track is stored for this match, so the net read, the
          no-return read and the repair pass could not run. What is above is
          what the touches alone support.
        </p>
      ) : (
        summary.withTrack < summary.points && (
          <p className="mt-3 text-xs text-zinc-600">
            {summary.points - summary.withTrack} of {summary.points} cards have
            no ball track, so two of the three rules could not run on them.
          </p>
        )
      )}
    </div>
  );
}

function DetectorCounts({
  assembly,
}: {
  assembly: ReturnType<typeof readAssembly>;
}) {
  const endOn = assembly.route === "end-on";
  const has =
    assembly.serves !== null ||
    assembly.crossings !== null ||
    assembly.cardsWithServe !== null;
  if (!has) return null;

  return (
    <div className="mt-4 rounded-2xl border border-edge bg-surface p-4">
      <p className="text-sm font-medium text-zinc-200">
        What the detector saw
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {assembly.serves !== null && (
          <Counted
            label="Serves found"
            value={assembly.serves}
            detail={endOn ? "not looked for" : null}
          />
        )}
        {assembly.crossings !== null && (
          <Counted label="Net crossings" value={assembly.crossings} />
        )}
        {assembly.cards !== null && (
          <Counted label="Cards built" value={assembly.cards} />
        )}
        {assembly.cameraShape !== null && (
          <Counted
            label="Camera shape"
            value={assembly.cameraShape.toFixed(2)}
            detail={assembly.cameraShape < 0.5 ? "flat, down the lens" : "across the lens"}
          />
        )}
      </dl>

      {endOn ? (
        <p className="mt-3 text-sm text-zinc-500">
          The end-on assembler segments the whole match on motion and never
          claims a serve, so every card here has none by design. It used the{" "}
          {assembly.crossings ?? 0} net crossings as boundary evidence.
          Its own segmentation figures are not recorded.
        </p>
      ) : (
        assembly.cardsWithServe !== null && (
          <p className="mt-3 text-sm text-zinc-500">
            {assembly.cardsWithServe} of{" "}
            {(assembly.cardsWithServe ?? 0) + (assembly.cardsWithoutServe ?? 0)}{" "}
            cards are anchored on a detected serve
            {assembly.cardsWithoutServe
              ? `; ${assembly.cardsWithoutServe} were built without one.`
              : "."}
          </p>
        )
      )}
    </div>
  );
}

function Counted({
  label,
  value,
  detail = null,
}: {
  label: string;
  value: number | string;
  detail?: string | null;
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">
        {value}
      </dd>
      {detail && <p className="text-xs text-zinc-600">{detail}</p>}
    </div>
  );
}

function Fact({
  label,
  value,
  detail = null,
}: {
  label: string;
  value: string;
  detail?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-4">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-base font-medium text-zinc-100">{value}</dd>
      {detail && <p className="mt-0.5 text-xs text-zinc-600">{detail}</p>}
    </div>
  );
}
