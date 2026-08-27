import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { TEST_SURFACES, type TestSurface } from "@/lib/qa/testLibrary";
import { requireTesting } from "../requireTesting";
import { LibraryBrowser } from "./LibraryBrowser";

export const metadata: Metadata = {
  title: "Test library",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /testing/library — what to test and what correct looks like. The content
 * is static data (src/lib/qa/testLibrary.ts), so this page is a filter
 * over an import rather than a query.
 *
 * The download is the point of the CSV: run tracking lives in the tester's
 * own sheet, and this is the file that sheet starts from.
 *
 * ?surface= picks which of the four the page is about. It is a real URL
 * rather than client state alone so each surface is a link that can be
 * bookmarked, which is what "a separate page for mobile" actually asked
 * for. An unknown or missing value falls back to the desktop browser,
 * where every mark made before 142 was recorded.
 */
export default async function TestLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string }>;
}) {
  const { surface: asked } = await searchParams;
  const surface: TestSurface =
    TEST_SURFACES.find((s) => s.key === asked)?.key ?? "web-desktop";

  const { user, avatarUrl } = await requireTesting("/testing/library");

  return (
    <AppShell avatarUrl={avatarUrl} wide>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Test library
        </h1>
        <a
          href={`/api/qa/export?what=library&surface=${surface}`}
          className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-cyan-glow"
        >
          Download as a spreadsheet
        </a>
      </div>

      <LibraryBrowser userId={user.id} surface={surface} />

      <p className="mt-10 text-sm text-zinc-500">
        A case that no longer matches the product is a bug in this library.{" "}
        <Link href="/testing/report" className="text-cyan-glow">
          Report it
        </Link>{" "}
        the same way you would anything else.
      </p>
    </AppShell>
  );
}
