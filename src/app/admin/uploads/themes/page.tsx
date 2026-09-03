import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../../requireAdmin";
import { AdminHeader } from "../../AdminHeader";
import { formatClock, whenLabel } from "../uploadView";

export const metadata: Metadata = {
  title: "Review themes",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface ReviewRow {
  point_id: string;
  match_id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string | null;
  idx: number;
  t0: number;
  t1: number;
  note: string | null;
  note_at: string | null;
  themes: string[];
}

/**
 * Everything noted while reviewing, grouped by theme (150).
 *
 * The per-card boxes are where observations go in; this is the only place
 * they come back out. Reviewing two thousand cards is only worth doing if
 * the same remark on eleven different matches can be read as one list —
 * that is the whole reason themes exist rather than notes alone.
 *
 * A card can carry several themes, so it appears under each. Grouping by
 * the commonest first puts the biggest pattern at the top, which is the
 * question this page is asked.
 */
export default async function AdminReviewThemesPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}) {
  const { supabase, avatarUrl } = await requireAdmin();
  const { theme } = await searchParams;

  const [themesRes, rowsRes] = await Promise.all([
    supabase.rpc("admin_themes_list"),
    supabase.rpc("admin_review_notes", { p_theme_id: theme ?? null }),
  ]);

  const themes = (themesRes.data ?? []) as {
    id: string;
    label: string;
    points: number;
  }[];
  const rows = (rowsRes.data ?? []) as ReviewRow[];
  const error = themesRes.error?.message ?? rowsRes.error?.message ?? null;
  const selected = themes.find((t) => t.id === theme) ?? null;

  return (
    <AppShell avatarUrl={avatarUrl} wide>
      <AdminHeader title="Review themes" backHref="/admin/uploads" />
      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}

      <div className="mt-6 flex flex-wrap gap-1.5">
        <Link
          href="/admin/uploads/themes"
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
            selected
              ? "border-edge text-zinc-400 hover:text-white"
              : "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
          }`}
        >
          Everything noted
        </Link>
        {themes.map((t) => (
          <Link
            key={t.id}
            href={`/admin/uploads/themes?theme=${t.id}`}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              selected?.id === t.id
                ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
                : "border-edge text-zinc-400 hover:text-white"
            }`}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums text-zinc-600">
              {t.points}
            </span>
          </Link>
        ))}
      </div>

      {themes.length === 0 && !error && (
        <p className="mt-6 text-sm text-zinc-500">
          No themes yet. Open an upload, pick a card, and add one there.
        </p>
      )}

      {rows.length === 0 && themes.length > 0 && (
        <p className="mt-6 text-sm text-zinc-500">
          {selected ? "Nothing under this theme yet." : "Nothing noted yet."}
        </p>
      )}

      <ul className="mt-6 space-y-2">
        {rows.map((row) => (
          <li key={row.point_id}>
            {/* Straight back to the card it came from: a note is only
                useful if the footage behind it is one tap away. */}
            <Link
              href={`/admin/uploads/${row.match_id}`}
              className="block rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-zinc-200">
                  {row.opponent_name || "Match"}
                  <span className="ml-2 font-normal tabular-nums text-zinc-500">
                    {formatClock(Number(row.t0))} →{" "}
                    {formatClock(Number(row.t1))}
                  </span>
                </p>
                <p className="text-xs text-zinc-500">
                  {[whenLabel(row.played_at), row.venue]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {row.note && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
                  {row.note}
                </p>
              )}
              {row.themes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {row.themes.map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-edge px-2.5 py-0.5 text-xs text-zinc-500"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
