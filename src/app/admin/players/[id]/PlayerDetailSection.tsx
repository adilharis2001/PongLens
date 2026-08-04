"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCost } from "@/lib/costs/calculations";
import { AdminHeader } from "../../AdminHeader";
import { CutVideo } from "./CutVideo";
import { PointBreakdown } from "./PointBreakdown";
import {
  countLabel,
  durationsLabel,
  gbLabel,
  retentionLabel,
  scoringLabel,
  whenLabel,
  type PlayerDetailPayload,
  type PlayerMatchRow,
} from "../playersView";

/**
 * One player, in full: who they are, how much they use the app, and every
 * upload with both timelines and a play button for the cut itself
 * (admin-signed through /api/admin/media-url). Note counts only — the
 * notes themselves stay private.
 */

export function PlayerDetailSection({ userId }: { userId: string }) {
  const [data, setData] = useState<PlayerDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .rpc("admin_player_detail", { p_user_id: userId })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setData(data as PlayerDetailPayload);
      });
  }, [userId]);

  if (error) {
    return (
      <>
        <AdminHeader title="Player" backHref="/admin/players" />
        <p className="mt-6 text-sm text-red-400">{error}</p>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <AdminHeader title="Player" backHref="/admin/players" />
        <div className="mt-6 h-40 animate-pulse rounded-2xl border border-edge bg-surface" />
      </>
    );
  }

  const profile = data.profile;
  if (!profile) {
    return (
      <>
        <AdminHeader title="Player" backHref="/admin/players" />
        <p className="mt-6 text-sm text-zinc-500">No such account.</p>
      </>
    );
  }

  const e = data.engagement;
  const traits = [profile.handedness, profile.grip, profile.style]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <AdminHeader
        title={profile.name || profile.email}
        backHref="/admin/players"
      />

      {/* Who they are */}
      <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm text-zinc-300">{profile.email}</p>
            <p className="mt-1 text-xs text-zinc-500">
              Joined {whenLabel(profile.created_at)}
              {profile.last_sign_in_at &&
                ` · Last signed in ${whenLabel(profile.last_sign_in_at)}`}
              {profile.access_source && ` · In via ${profile.access_source}`}
            </p>
            {traits && <p className="mt-1 text-xs text-zinc-500">{traits}</p>}
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-xs text-zinc-500">Storage</p>
              <p className="mt-1 text-sm tabular-nums text-zinc-200">
                {gbLabel(profile.used_bytes)} /{" "}
                {gbLabel(profile.storage_limit_bytes)}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Est. cost</p>
              <p className="mt-1 text-sm font-medium tabular-nums text-cyan-glow">
                {formatCost(data.est_cost_usd)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* How much they use it */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Notes"
          value={e.notes}
          detail={e.voice_notes > 0 ? `${e.voice_notes} voice` : null}
        />
        <StatTile label="Journal entries" value={e.journal_entries} />
        <StatTile
          label="Tags"
          value={e.tags}
          detail={e.tagged_points > 0 ? `${e.tagged_points} points` : null}
        />
        <StatTile label="Share links" value={e.share_links} />
        <StatTile label="Coaches" value={e.coaches} />
        <StatTile label="Recollect runs" value={e.recollect_jobs} />
        <StatTile
          label="Failed uploads"
          value={e.uploads_failed}
          warning={e.uploads_failed > 0}
        />
      </div>

      {/* Every upload */}
      <h2 className="mt-10 text-lg font-semibold">Uploads</h2>
      {data.matches.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No uploads yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {data.matches.map((m) => (
            <UploadRow key={m.id} match={m} />
          ))}
        </ul>
      )}
    </>
  );
}

function StatTile({
  label,
  value,
  detail = null,
  warning = false,
}: {
  label: string;
  value: number;
  detail?: string | null;
  warning?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          warning ? "text-amber-300" : "text-zinc-100"
        }`}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-zinc-600">{detail}</p>}
    </div>
  );
}

function UploadRow({ match }: { match: PlayerMatchRow }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoKind, setVideoKind] = useState<"cut" | "raw">("cut");
  const [loading, setLoading] = useState<"cut" | "raw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPoints, setShowPoints] = useState(false);

  // One player, two sources: the cut and the ORIGINAL upload. Grading
  // the cut means checking what it removed, which only the raw shows.
  const watch = async (kind: "cut" | "raw") => {
    if (videoUrl && videoKind === kind) {
      setVideoUrl(null);
      return;
    }
    setLoading(kind);
    setError(null);
    try {
      const res = await fetch("/api/admin/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "raw" ? { matchId: match.id, raw: true } : { matchId: match.id }
        ),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Could not load the video.");
        return;
      }
      setVideoKind(kind);
      setVideoUrl(body.url);
    } catch {
      setError("Could not load the video.");
    } finally {
      setLoading(null);
    }
  };

  const durations = durationsLabel(match.src_duration_s, match.cut_duration_s);
  const retention = retentionLabel(match.src_duration_s, match.cut_duration_s);
  const trouble =
    match.status !== "ready"
      ? match.job_error || `Status: ${match.status}`
      : match.placement_status === "failed"
        ? "Placement failed"
        : null;

  const facts = [
    scoringLabel(match),
    match.starred > 0 ? `${match.starred} starred` : null,
    match.notes > 0 ? countLabel(match.notes, "note") : null,
    match.exports > 0 ? countLabel(match.exports, "export") : null,
  ].filter(Boolean);

  return (
    <li className="rounded-2xl border border-edge bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-200">
            {match.opponent_name || "Match"}
            {match.match_type && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                {match.match_type}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {whenLabel(match.played_at ?? match.created_at)}
            {durations && ` · ${durations}`}
            {retention && (
              <span className="text-cyan-glow"> · {retention}</span>
            )}
          </p>
        </div>
        {match.points > 0 && (
          <button
            type="button"
            onClick={() => setShowPoints((open) => !open)}
            className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white"
          >
            {showPoints ? "Hide points" : "Points"}
          </button>
        )}
        {match.has_cut && (
          <button
            type="button"
            onClick={() => void watch("cut")}
            disabled={loading !== null}
            className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-60"
          >
            {loading === "cut"
              ? "Loading…"
              : videoUrl && videoKind === "cut"
                ? "Close"
                : "Watch"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void watch("raw")}
          disabled={loading !== null}
          title="The original upload, uncut (kept 30 days)"
          className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-60"
        >
          {loading === "raw"
            ? "Loading…"
            : videoUrl && videoKind === "raw"
              ? "Close"
              : "Original"}
        </button>
      </div>

      <p className="mt-2 text-xs text-zinc-500">{facts.join(" · ")}</p>
      {trouble && <p className="mt-1 text-xs text-amber-300">{trouble}</p>}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {videoUrl && <CutVideo url={videoUrl} />}
      {showPoints && <PointBreakdown matchId={match.id} />}
    </li>
  );
}
