import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/AppShell";
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
 */
export default async function TestLibraryPage() {
  const { avatarUrl } = await requireTesting("/testing/library");

  return (
    <AppShell avatarUrl={avatarUrl} wide>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Test library
        </h1>
        <a
          href="/api/qa/export?what=library"
          className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-cyan-glow"
        >
          Download as a spreadsheet
        </a>
      </div>

      <LibraryBrowser />

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
