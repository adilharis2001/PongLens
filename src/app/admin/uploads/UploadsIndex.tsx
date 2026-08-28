import Link from "next/link";
import { AdminHeader } from "../AdminHeader";
import { formatClock, retentionPct, whenLabel } from "./uploadView";

/** One row of admin_recent_uploads (144). */
export interface UploadRow {
  id: string;
  user_id: string;
  email: string;
  owner_name: string | null;
  opponent_name: string | null;
  venue: string | null;
  status: string;
  created_at: string;
  played_at: string | null;
  points: number;
  scored: number;
  src_duration_s: number | null;
  cut_duration_s: number | null;
  placement_status: string | null;
  camera: string | null;
  has_cut: boolean;
  has_table: boolean;
}

/**
 * Every upload, newest first.
 *
 * Full-width cards, not a table. A table on this page would need a
 * horizontal scroll on a phone, which is exactly the defect the per-point
 * view was rebuilt to remove — and /admin/reviews still carries it.
 *
 * `camera` comes from matches.story_crop, which is null on every
 * vision-calibrated match as well as every uncalibrated one, so it is
 * shown only where it exists and never as evidence about the table.
 */
export function UploadsIndex({
  rows,
  error,
}: {
  rows: UploadRow[];
  error: string | null;
}) {
  return (
    <>
      <AdminHeader title="Uploads" backHref="/admin" />
      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {rows.length === 0 && !error ? (
        <p className="mt-6 text-sm text-zinc-500">No uploads yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((row) => {
            const retention = retentionPct(
              row.src_duration_s,
              row.cut_duration_s
            );
            const facts = [
              row.points > 0
                ? `${row.points} card${row.points === 1 ? "" : "s"}`
                : null,
              row.scored > 0 ? `${row.scored} scored` : null,
              retention != null ? `${retention}% kept` : null,
              formatClock(row.src_duration_s),
              row.camera,
              row.has_table ? null : "no processing record",
            ].filter(Boolean);

            return (
              <li key={row.id}>
                <Link
                  href={`/admin/uploads/${row.id}`}
                  className="block rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-200">
                        {row.opponent_name || "Match"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {row.owner_name || row.email}
                        {row.venue ? ` · ${row.venue}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs text-zinc-500">
                      {whenLabel(row.played_at ?? row.created_at)}
                    </p>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    {facts.join(" · ")}
                  </p>
                  {row.status !== "ready" && (
                    <p className="mt-1 text-xs text-amber-300">
                      {row.status === "uploaded"
                        ? "Not processed"
                        : `Status: ${row.status}`}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
