import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Logo } from "@/components/Logo";
import { MEDIA_BUCKET, getObject } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import type { ServeMissData } from "@/app/admin/uploads/serveMiss";
import { ThemeAnalysis } from "./ThemeAnalysis";
import { distinctMatchIds, type ThemeCardRow, type ThemeRow } from "./themeView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Theme analysis",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The per-card serve diagnosis for one match, read on the SERVER.
 *
 * Two places, in the order the admin page reads them: beside match.json
 * for anything processed since the worker started writing it, then the
 * research prefix where the earlier offline pass left its copies.
 *
 * It has to be read here rather than in the browser. R2 sends no
 * Access-Control-Allow-Origin, so a presigned URL cannot be fetch()ed from
 * a page at all — the request dies in preflight. A `<video>` element is
 * exempt, which is why the footage itself is signed on the client and only
 * the JSON beside it comes through the server.
 *
 * Every failure degrades to null: a match with no diagnosis loses the
 * drawing on its cards and keeps everything else.
 */
async function readServeMisses(
  matchJsonPath: string | null,
  matchId: string
): Promise<ServeMissData | null> {
  const prefix = `r2://${MEDIA_BUCKET}/`;
  const keys: string[] = [];
  if (matchJsonPath?.startsWith(prefix)) {
    keys.push(
      matchJsonPath.slice(prefix.length).replace(/match\.json$/, "serves.json")
    );
  }
  keys.push(`research/crossings/${matchId}.serves.json`);
  for (const key of keys) {
    try {
      const object = await getObject(MEDIA_BUCKET, key);
      if (!object) continue;
      return JSON.parse(new TextDecoder().decode(object.body)) as ServeMissData;
    } catch {
      // A malformed diagnosis costs one match's drawing, not the page.
    }
  }
  return null;
}

/**
 * Every card noted under a theme, across every match, with its footage.
 *
 * Admin only, like the rest of /research. The themes are an operator's
 * private notebook about other people's uploads, so there is no reviewer
 * path in here: `research_reviewers` grants the labeling tools, not this.
 */
export default async function ThemeAnalysisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/themes");

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const [themesRes, rowsRes] = await Promise.all([
    supabase.rpc("admin_themes_list"),
    supabase.rpc("admin_theme_cards", { p_theme_id: null }),
  ]);

  const themes = (themesRes.data ?? []) as ThemeRow[];
  const rows = (rowsRes.data ?? []) as ThemeCardRow[];
  const error = themesRes.error?.message ?? rowsRes.error?.message ?? null;

  // One read per MATCH, not per card: the diagnosis describes the whole
  // match, and three cards on the same upload would otherwise fetch the
  // same file three times.
  const matchIds = distinctMatchIds(rows);
  const byMatch = await Promise.all(
    matchIds.map(async (id) => {
      const path =
        rows.find((r) => r.match_id === id)?.match_json_path ?? null;
      return [id, await readServeMisses(path, id)] as const;
    })
  );
  const missByMatch = Object.fromEntries(byMatch);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <Logo href="/dashboard" />
        <a
          href="/research"
          className="text-sm text-zinc-400 transition-colors hover:text-white"
        >
          All research
        </a>
      </div>

      <h1 className="mt-8 text-3xl font-bold tracking-tight">
        Theme analysis
      </h1>

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}

      <ThemeAnalysis
        themes={themes}
        rows={rows}
        missByMatch={missByMatch}
      />
    </main>
  );
}
