import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  getPlacementServesOnly,
  getSupportEmail,
  getTapEndPlayback,
  getUnscoredRallyEnd,
  getUnscoredRallyEndBufferS,
} from "@/lib/config";
import { Logo } from "@/components/Logo";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import { clipPad } from "@/app/match/[id]/clipEdit";
import { skipSpans } from "@/app/match/[id]/playhead";
import { computeMatchAnalysis } from "@/app/match/[id]/matchAnalysis";
import { computeMatchStats } from "@/app/match/[id]/matchStats";
import { computeServing } from "@/app/match/[id]/serving";
import {
  collectServePlacementObservations,
  collectTrustedPlacementObservations,
  trustedPlacementPointCount,
} from "@/lib/placement/placementAggregate";
import type { MapLabels } from "@/app/match/[id]/PlacementMap";
import type { Point } from "@/lib/types";
import { ShareView } from "./ShareView";
import { ShareResult } from "./ShareResult";
import { ShareStats } from "./ShareStats";
import { SharePlacement } from "./SharePlacement";
import { StarredView, type StarredClip } from "./StarredView";
import { ShareEntry } from "./ShareEntry";
import {
  playersLine,
  pointContextLine,
  sharePlayers,
  sharePointsAsPoints,
  starredContextLine,
  tagContextLine,
  type ResolvedShareEntry,
  type ResolvedShareLink,
  type ResolvedSharePlacement,
  type ResolvedSharePoint,
  type ResolvedShareRemoved,
  type ResolvedStarredPoint,
} from "./shareData";

/**
 * Public share page — the ONLY logged-out surface that shows match media.
 * No AppNav/AppShell chrome, noindex, and strictly the public subset:
 *
 *   point   — that point's clip
 *   match   — the cut video, plus (when the owner left the score on) the
 *             result, the numbers and the placement maps. Never the
 *             point-by-point rows.
 *   starred — the CURRENTLY starred clips, played sequentially. Resolved
 *             at view time: starring/unstarring changes what viewers see.
 *
 * Never notes, never the owner's self-reported loss reasons, never their
 * serve tagging. Everything published here is either in the video already
 * or derived from it. Resolution goes through the SECURITY DEFINER resolve
 * functions; unknown and revoked tokens both land on the same minimal
 * "turned off" page.
 *
 * SHOW_SCORE IS ONE SWITCH FOR THE WHOLE SCORED HALF. The bug over the
 * video, the result and the analysis are the same fact told three ways, so
 * they answer to the same owner choice rather than to three of them.
 */

const resolve = cache(
  async (token: string): Promise<ResolvedShareLink | null> => {
    if (!token || token.length < 32 || token.length > 128) return null;
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_share_link", {
      p_token: token,
    });
    return (data?.[0] as ResolvedShareLink | undefined) ?? null;
  }
);

const resolveStarred = cache(
  async (token: string): Promise<ResolvedStarredPoint[]> => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_share_starred", {
      p_token: token,
    });
    return (data ?? []) as ResolvedStarredPoint[];
  }
);

// The visible points of a MATCH link. Fetched for every match link, not
// just scored ones: the rally boundaries are what the player's double-tap
// walks, and that gesture is not part of the score.
const resolveSharePoints = cache(
  async (token: string): Promise<ResolvedSharePoint[]> => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_share_points", {
      p_token: token,
    });
    return (data ?? []) as ResolvedSharePoint[];
  }
);

// The dead footage a MATCH link's player jumps: the deleted cards'
// boundaries (139) plus the match's clip pads, folded together with the
// visible points through playhead.skipSpans. Either call failing answers
// [] / null — the 133 rule: a missing answer is "no spans", and the page
// then plays exactly as it did before 139.
const resolveShareSkips = cache(
  async (
    token: string,
    visible: Point[]
  ): Promise<{ start: number; end: number }[]> => {
    const supabase = await createClient();
    const [removedRes, padsRes, tapEnd, rallyOn, rallyBuffer] =
      await Promise.all([
        supabase.rpc("resolve_share_removed", { p_token: token }),
        supabase.rpc("resolve_share_clip_pads", { p_token: token }),
        getTapEndPlayback(),
        getUnscoredRallyEnd(),
        getUnscoredRallyEndBufferS(),
      ]);
    const ends = {
      tapEnd,
      rallyEnd: { on: rallyOn, bufferS: rallyBuffer },
    };
    const removed = ((removedRes.data ?? []) as ResolvedShareRemoved[]).map(
      (r) =>
        ({
          id: `removed-${r.cut_t0}`,
          idx: -1,
          t0: r.t0,
          t1: r.t1,
          cut_t0: r.cut_t0,
          deleted: true,
          edited: false,
          tight_start: r.tight_start ?? false,
          tight_end: r.tight_end ?? false,
          is_let: false,
          starred: false,
          clip_path: null,
          confirmed_winner: null,
          scored_at_cut_s: null,
        }) as unknown as Point
    );
    const pad = clipPad(
      null,
      (padsRes.data ?? null) as { pre: number; post: number } | null
    );
    const rows = [...visible, ...removed].sort(
      (a, b) =>
        Number(a.cut_t0 ?? Number.POSITIVE_INFINITY) -
        Number(b.cut_t0 ?? Number.POSITIVE_INFINITY)
    );
    return skipSpans(rows, pad, ends);
  }
);

// A journal entry link (154). Entry tokens live in the same URL space as
// match tokens but resolve through their own function — resolve_share_link
// joins matches and answers nothing for them — so the page asks this only
// after the match resolver has come up empty.
const resolveEntry = cache(
  async (token: string): Promise<ResolvedShareEntry | null> => {
    if (!token || token.length < 32 || token.length > 128) return null;
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_share_entry", {
      p_token: token,
    });
    return (data?.[0] as ResolvedShareEntry | undefined) ?? null;
  }
);

// Tag links resolve their point set live too (same shape as starred).
const resolveTagged = cache(
  async (token: string): Promise<ResolvedStarredPoint[]> => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_share_tagged", {
      p_token: token,
    });
    return (data ?? []) as ResolvedStarredPoint[];
  }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const link = await resolve(token);
  const robots = { index: false, follow: false };
  if (!link) {
    const entry = await resolveEntry(token);
    if (!entry) return { title: "PongLens", robots };
    const title = entryLines(entry).heading;
    const description = "A training journal entry on PongLens.";
    return {
      title,
      description,
      robots,
      openGraph: { title: `${title} · PongLens`, description },
      twitter: {
        card: "summary_large_image",
        title: `${title} · PongLens`,
        description,
      },
    };
  }
  const names = playersLine(link);
  const custom = link.title?.trim() || null;
  let title: string;
  let description: string;
  if (link.kind === "point") {
    title = custom ?? pointContextLine(link);
    description = "Watch this table tennis point on PongLens.";
  } else if (link.kind === "starred") {
    const starred = await resolveStarred(token);
    title = custom ?? starredContextLine(starred.length, names);
    description = "Watch these table tennis points on PongLens.";
  } else if (link.kind === "tag") {
    const tagged = await resolveTagged(token);
    title = custom ?? tagContextLine(link.tag_label, tagged.length, names);
    description = "Watch these table tennis points on PongLens.";
  } else {
    title = custom ?? names ?? "Match";
    description = "Watch this table tennis match on PongLens.";
  }
  return {
    title,
    description,
    robots,
    openGraph: { title: `${title} · PongLens`, description },
    twitter: { card: "summary_large_image", title: `${title} · PongLens`, description },
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// A shared entry's two header lines. The heading prefers the stored title
// (the share sheet sends the entry's current headline, and re-sharing
// refreshes it), then the takeaways title, then the plain kind-and-date
// line — and when the heading IS that machine line, the subline does not
// repeat it, same rule the match page applies to its own titles.
function entryLines(entry: ResolvedShareEntry): {
  heading: string;
  subLine: string;
} {
  const kindLine =
    entry.entry_kind === "practice"
      ? "Practice"
      : entry.coach_name
        ? `Lesson with ${entry.coach_name}`
        : "Lesson";
  const machineLine = `${kindLine} · ${formatDate(entry.entry_created_at)}`;
  const heading = entry.title?.trim() || entry.takeaways?.title || machineLine;
  const subLine = [
    heading === machineLine ? null : machineLine,
    entry.owner_name ? `${entry.owner_name}'s journal` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { heading, subLine };
}

function LinkOff() {
  return (
    <main className="bg-arena flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <Logo />
      <p className="text-sm text-zinc-400">This link was turned off.</p>
    </main>
  );
}

/**
 * The placement maps, fetched and reduced on the server.
 *
 * Its own async component, awaited inline. It was briefly behind a
 * Suspense boundary — the placement column is hundreds of kilobytes of
 * JSON and the video has no reason to wait for it — but the streamed
 * content never got swapped out of React's hidden staging div, so the
 * maps rendered into a `<div hidden>` and were never seen. Not worth
 * chasing: the whole request measures ~160ms WITH this fetch in it,
 * because the heavy part never crosses the wire to the browser. If the
 * fetch ever does become the slow half, stream it then and verify the
 * swap actually happens.
 */
async function PlacementSection({
  token,
  points,
  userSide,
  firstServer,
  labels,
}: {
  token: string;
  points: Point[];
  userSide: "near" | "far" | null;
  firstServer: "user" | "opponent" | null;
  labels: MapLabels;
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("resolve_share_placement", {
    p_token: token,
  });
  const rows = (data ?? []) as ResolvedSharePlacement[];
  if (rows.length === 0) return null;

  const byId = new Map(rows.map((r) => [r.id, r.placement]));
  const withPlacement = points.map((p) => ({
    ...p,
    placement: byId.get(p.id) ?? null,
  }));

  // Players change ends every game, so the user's physical side flips on
  // odd games — the maps are wrong without this. Same walk MatchView does.
  const score = computeMatchScore(withPlacement);
  const gameIndexByPoint = new Map<string, number>();
  let game = 0;
  for (const p of withPlacement) {
    gameIndexByPoint.set(p.id, game);
    if (score.boundaryAfter.has(p.id)) game += 1;
  }

  const serving = computeServing(withPlacement, firstServer);
  // The same switch the owner's match page reads (132), so one match
  // cannot show serves here and every landing there.
  const servesOnly = await getPlacementServesOnly();
  const observations = (
    servesOnly
      ? collectServePlacementObservations
      : collectTrustedPlacementObservations
  )({
    points: withPlacement,
    userSide,
    gameIndexByPoint,
    serving,
  });
  // Too little to draw is not the same as nothing to draw, and on a public
  // page it looks the same as broken: a table with two dots on it reads as
  // a feature that failed, not as a match the vision could not follow.
  // Three is the floor the aggregate's own `sparse` check uses, so the two
  // surfaces agree about what counts as too little. Matches whose
  // calibration was poor simply have no maps section here.
  const mappedPoints = trustedPlacementPointCount(observations);
  if (mappedPoints < 3) return null;

  return (
    <SharePlacement
      observations={observations}
      mappedPoints={mappedPoints}
      totalPoints={points.length}
      labels={labels}
      servesOnly={servesOnly}
    />
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await resolve(token);

  // A journal entry link: its own quiet reading page. No video machinery,
  // no score — an entry is text, maybe a photo, and a transcript.
  if (!link) {
    const entry = await resolveEntry(token);
    if (!entry) return <LinkOff />;
    const entrySupportEmail = await getSupportEmail();
    const { heading, subLine } = entryLines(entry);
    return (
      <main className="bg-arena flex min-h-screen flex-col">
        <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10 sm:max-w-lg">
          <header className="pt-5 sm:pt-8">
            <Logo />
            <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
              {heading}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">{subLine}</p>
          </header>

          <ShareEntry
            token={token}
            entry={{
              transcript: entry.transcript,
              takeaways: entry.takeaways,
              hasImage: Boolean(entry.image_path),
            }}
          />

          <Link
            href="/"
            className="glow-cta mt-8 block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink"
          >
            Start your own journal on PongLens
          </Link>
        </div>

        <footer className="mt-8 border-t border-edge/60 px-4 py-6">
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3">
            <Logo />
            <a
              href={`mailto:${entrySupportEmail}?subject=Report%20a%20shared%20journal%20entry`}
              className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
            >
              Report this entry
            </a>
          </div>
        </footer>
      </main>
    );
  }

  const supportEmail = await getSupportEmail();

  const names = playersLine(link);
  const { you, them } = sharePlayers(link);
  const isPoint = link.kind === "point";
  const isStarred = link.kind === "starred";
  const isTag = link.kind === "tag";
  const isMatch = link.kind === "match";
  const isCollection = isStarred || isTag;

  // Starred/tag links: the current clip list, resolved right now.
  let clips: StarredClip[] = [];
  if (isCollection) {
    const rows = isStarred
      ? await resolveStarred(token)
      : await resolveTagged(token);
    clips = rows.map((p) => ({
      id: p.id,
      number: p.number,
      duration:
        p.t0 !== null && p.t1 !== null
          ? Math.max(0, Number(p.t1) - Number(p.t0))
          : null,
    }));
  }

  const points: ResolvedSharePoint[] = isMatch
    ? await resolveSharePoints(token)
    : [];

  // The scored half of the page, computed here rather than in the browser:
  // MatchScore carries a Map and a Set, neither of which survives the
  // server-to-client boundary, and none of this needs to be interactive.
  const asPoints = sharePointsAsPoints(points, link.match_id);
  const deadSpans = isMatch ? await resolveShareSkips(token, asPoints) : [];
  const scored =
    isMatch &&
    link.show_score &&
    points.some((p) => !p.is_let && p.confirmed_winner !== null);
  const score = scored ? computeMatchScore(asPoints) : null;
  const serving = scored ? computeServing(asPoints, link.first_server) : null;
  const stats =
    score && serving ? computeMatchStats(asPoints, serving, score) : null;
  const analysis = serving ? computeMatchAnalysis(asPoints, serving) : null;
  const showMaps =
    scored && link.placement_status === "ready" && !link.placement_flagged;
  // near/far are the neutral fallbacks the maps use when a side has no
  // name of its own; here the two players are always known by then.
  const mapLabels = {
    you,
    them,
    near: link.user_side === "far" ? them : you,
    far: link.user_side === "far" ? you : them,
  };

  // Owner-written title (when set) is the headline; the machine context
  // line ("Point 14 · 12s rally", "5 points · Adil vs Marco") demotes to
  // the small secondary line. Null title keeps the machine line on top.
  const machineLine = isPoint
    ? pointContextLine(link)
    : isStarred
      ? starredContextLine(clips.length, names)
      : isTag
        ? tagContextLine(link.tag_label, clips.length, names)
        : (names ?? "Match");
  const customTitle = link.title?.trim() || null;
  const heading = customTitle ?? machineLine;
  const subLine = [
    // The owner's title often IS the matchup ("Adil vs Vaibhav 2022"),
    // which the machine line now derives too — printing both put the same
    // words on two consecutive lines.
    customTitle && customTitle !== machineLine ? machineLine : null,
    isPoint && names ? names : null,
    formatDate(link.played_at),
    (link.venue ?? "").trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="bg-arena flex min-h-screen flex-col">
      <div className="mx-auto w-full max-w-md flex-1 pb-10 sm:max-w-lg lg:max-w-3xl">
        <header className="px-4 pt-5 sm:pt-8">
          <Logo />
          <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
            {heading}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{subLine}</p>
        </header>

        {/* Media-first: edge to edge on a phone, where a rounded card
            inside a padded column only makes the picture smaller. The card
            treatment comes back once there is room beside it. */}
        <div className="mt-4 sm:px-4">
          {isCollection ? (
            clips.length > 0 ? (
              <StarredView token={token} clips={clips} />
            ) : (
              <div className="flex aspect-video items-center justify-center border-y border-edge bg-ink sm:rounded-2xl sm:border">
                <p className="text-sm text-zinc-500">Nothing here right now.</p>
              </div>
            )
          ) : isMatch && !link.cut_path && !link.raw_path ? (
            /* Neither video exists (a legacy match whose original was
               swept before 096 protected library videos): say so, rather
               than mounting a player that retries forever. */
            <div className="flex aspect-video items-center justify-center border-y border-edge bg-ink sm:rounded-2xl sm:border">
              <p className="text-sm text-zinc-500">
                This video is no longer available.
              </p>
            </div>
          ) : (
            <ShareView
              token={token}
              kind={isPoint ? "point" : "match"}
              matchId={link.match_id}
              points={points}
              skipSpans={deadSpans}
              showScore={Boolean(scored)}
              you={you}
              them={them}
            />
          )}
        </div>

        <div className="px-4">
          {score && (
            <ShareResult
              you={you}
              them={them}
              games={score.games}
              gamesYou={score.gamesYou}
              gamesThem={score.gamesThem}
            />
          )}

          {stats && analysis && (
            <ShareStats
              stats={stats}
              momentum={analysis.momentum}
              you={you}
              them={them}
            />
          )}

          {showMaps && (
            <PlacementSection
              token={token}
              points={asPoints}
              userSide={link.user_side}
              firstServer={link.first_server}
              labels={mapLabels}
            />
          )}

          <Link
            href="/"
            className="glow-cta mt-8 block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink"
          >
            Analyze your own match — free
          </Link>
        </div>
      </div>

      <footer className="mt-8 border-t border-edge/60 px-4 py-6">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 sm:max-w-lg">
          <Logo />
          <a
            href={`mailto:${supportEmail}?subject=Report%20a%20shared%20video`}
            className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
          >
            Report this video
          </a>
        </div>
      </footer>
    </main>
  );
}
