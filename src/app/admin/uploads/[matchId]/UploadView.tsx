"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Point } from "@/lib/types";
import type { EndOptions } from "../../../match/[id]/playhead";
import { clipPad, effectivePad } from "../../../match/[id]/clipEdit";
import { computeServing } from "../../../match/[id]/serving";
import {
  buildPointRows,
  formatClock,
  gbLabel,
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
import { PointCard } from "./PointCard";
import { TableQuad } from "./TableQuad";
import { UploadTape } from "./UploadTape";

/** Sentinel for "the tape is showing the original, not a card". */
const RAW_TAPE = "__raw__";

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
  ends,
}: {
  detail: UploadDetail;
  matchJson: MatchJson | null;
  ends: EndOptions;
}) {
  const { match, owner, job, totals } = detail;

  const [cutUrl, setCutUrl] = useState<string | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [tapeAt, setTapeAt] = useState<string | null>(null);
  const [tapeSource, setTapeSource] = useState<"cut" | "raw">("cut");

  const rows = useMemo(() => buildPointRows(detail.points), [detail.points]);
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
  const retention = retentionPct(totals.src_duration_s, totals.cut_duration_s);
  const playable = rows.filter((r) => r.cut_t0 !== null);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6">
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
            label="Source"
            value={src?.width ? `${src.width}×${src.height}` : "Not recorded"}
            detail={src?.fps ? `${src.fps.toFixed(2)} fps` : null}
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
          <ul className="mt-4 space-y-2">
            {rows.map((row) => (
              <PointCard
                key={row.id}
                row={row}
                serve={serving.get(row.id) ?? null}
                names={names}
                pad={pad}
                ends={ends}
                playable={row.cut_t0 !== null && !!cutUrl}
                onPlay={() => openCutAt(row.id)}
              />
            ))}
          </ul>
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
