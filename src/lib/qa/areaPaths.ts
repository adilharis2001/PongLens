/**
 * Which source paths belong to which test area.
 *
 * The point of this map is the question nobody can answer from the
 * library alone: this release changed these files, so which cases need
 * running again? That is a property of the diff, not of a case, so no
 * amount of tagging cases gets you there. `npm run qa:affected` walks a
 * commit range through this map and prints the case ids.
 *
 * Prefixes, matched against repo-relative paths. A file may belong to
 * several areas, and several of them deliberately do: touching the match
 * page moves scoring, placement and notes as well, because they are all
 * rendered by it.
 *
 * Kept honest by areaPaths.test.ts, which asserts every prefix still
 * exists on disk. A map full of paths that were renamed a year ago is
 * worse than no map, because it answers confidently and wrongly.
 */

import type { TestArea } from "./testLibrary";

export const AREA_PATHS: Record<TestArea, string[]> = {
  landing: [
    "src/app/page.tsx",
    "src/app/coaches",
    "src/app/videos",
    "src/app/terms",
    "src/app/privacy",
    "src/components/marketing",
    "src/components/SiteHeader.tsx",
    "src/components/SiteFooter.tsx",
  ],
  auth: [
    "src/app/auth",
    "src/app/login",
    "src/app/onboarding",
    "src/lib/auth",
    "src/lib/supabase",
    "src/middleware.ts",
    "src/components/AuthButton.tsx",
  ],
  nav: [
    "src/components/AppNav.tsx",
    "src/components/AppShell.tsx",
    "src/components/NotificationBell.tsx",
    "src/components/Fab.tsx",
  ],
  upload: [
    "src/app/upload",
    "src/app/dashboard/UploadCard.tsx",
    "src/components/YouTubeImport.tsx",
    "src/app/api/upload-url",
    "src/app/api/import-url",
    "src/app/api/process",
    "src/lib/uploadGuard.ts",
    "src/lib/quota.ts",
  ],
  // The worker is the whole pipeline: the cut, the point splitting and
  // the content gate all live there, and nothing in src can break them.
  processing: ["worker/", "src/app/api/process", "src/lib/costs"],
  match: [
    "src/app/match",
    "src/app/matches",
    "src/app/api/media-url",
    "src/app/api/download-url",
    "src/app/api/reel",
    "src/app/api/tag-reel",
    "src/lib/r2.ts",
    "src/lib/download.ts",
  ],
  scoring: [
    "src/app/match/[id]/PointScorecard.tsx",
    "src/app/match/[id]/scorecard.ts",
    "src/app/match/[id]/gameScore.ts",
    "src/app/match/[id]/matchStructure.ts",
    "src/app/match/[id]/serving.ts",
    "src/app/match/[id]/ScoreBug.tsx",
    "src/app/match/[id]/ScoreLine.tsx",
    "src/app/match/[id]/ServerChipMenu.tsx",
  ],
  placement: [
    "src/app/match/[id]/PlacementMap.tsx",
    "src/app/match/[id]/PlacementAggregate.tsx",
    "src/app/match/[id]/PlacementHeatMap.tsx",
    "src/app/match/[id]/PlacementFeedback.tsx",
    "src/app/match/[id]/PlacementToolsRow.tsx",
    "src/app/match/[id]/placementTable.tsx",
    "src/app/api/placement-generate",
    "src/lib/placement",
  ],
  notes: [
    "src/app/match/[id]/Notes.tsx",
    "src/app/match/[id]/Annotator.tsx",
    "src/app/api/transcribe",
    "src/app/api/note-image",
    "src/components/DictateButton.tsx",
  ],
  journal: [
    "src/app/journal",
    "src/app/improve",
    "src/lib/journal",
    "src/lib/recollect",
    "src/lib/ask",
    "src/app/api/journal-ask",
    "src/app/api/journal-entry",
    "src/app/api/journal-ocr",
    "src/app/api/recollect",
  ],
  stats: ["src/app/stats"],
  sharing: [
    "src/app/s",
    "src/app/api/share",
    "src/app/coach-invite",
    "src/components/ShareSheet.tsx",
    "src/components/ShareWithCoach.tsx",
    "src/components/SharingSection.tsx",
    "src/components/ShareQR.tsx",
  ],
  coaching: [
    "src/app/coaching",
    "src/app/coach/[handle]",
    "src/app/api/offerings",
    "src/app/api/coach-photo",
    "src/app/api/offering-image",
    "src/app/api/profile",
  ],
  orders: [
    "src/app/orders",
    "src/app/coaching/orders",
    "src/app/review-invite",
    "src/app/api/reviews",
    "src/app/api/stripe",
    "src/app/api/billing",
    "src/lib/reviews",
    "src/lib/payments",
    "src/lib/commerce",
  ],
  account: [
    "src/app/account",
    "src/components/PackTiles.tsx",
    "src/components/BalancesCard.tsx",
    "src/lib/config.ts",
  ],
  email: ["src/lib/email", "src/app/api/webhooks", "worker/worker.py"],
};

/**
 * Paths with no user-facing surface, so having no cases is correct rather
 * than a gap. Kept separate from AREA_PATHS on purpose: the difference
 * between "nothing to test here" and "nothing tests this yet" is the
 * whole value of the unmapped warning, and a list that reports both
 * teaches people to skip it.
 *
 * Migrations are deliberately NOT here. A schema change reaches users
 * through whichever area it touches, and that is a judgement worth making
 * out loud each time rather than defaulting to silence.
 */
export const NO_SURFACE: string[] = [
  "docs/",
  "scripts/",
  // The testing workspace itself. The tester does not test their own tool.
  "src/app/testing/",
  "src/lib/qa/",
  "src/app/api/qa/",
  // Admin pages have one user, who is also the person reading this output.
  "src/app/admin/",
  "src/app/research/",
  "src/app/marketing/",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "eslint.config.mjs",
  "next.config.ts",
  "postcss.config.mjs",
  "vercel.json",
  "CLAUDE.md",
  "README.md",
  "SPEC.md",
  "BACKLOG.md",
];

/**
 * Does one changed file sit under one mapped prefix?
 *
 * On a path boundary, not on characters. A bare startsWith puts
 * src/app/stats and src/app/showcase inside src/app/s, which is the share
 * link route, and the map then reports sharing cases for a stats change.
 */
function touches(path: string, prefix: string): boolean {
  if (path === prefix) return true;
  return path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/** Every area whose files the given repo-relative paths touch. */
export function areasForPaths(paths: string[]): TestArea[] {
  const hit = new Set<TestArea>();
  for (const path of paths) {
    for (const [area, prefixes] of Object.entries(AREA_PATHS)) {
      if (prefixes.some((p) => touches(path, p))) hit.add(area as TestArea);
    }
  }
  return [...hit];
}

/**
 * Changed files that belong to no area and are not known to be surfaceless.
 * Each one is either a hole in AREA_PATHS or a part of the product with no
 * test cases at all, and both are worth someone's attention.
 */
export function unmappedPaths(paths: string[]): string[] {
  return paths.filter((path) => {
    if (NO_SURFACE.some((p) => touches(path, p))) return false;
    // A test file is covered by whatever it tests.
    if (/\.test\.[cm]?[jt]sx?$/.test(path)) return false;
    return !Object.values(AREA_PATHS).some((prefixes) =>
      prefixes.some((p) => touches(path, p)),
    );
  });
}
