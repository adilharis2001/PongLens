import type { Metadata } from "next";

import { AppShell } from "@/components/AppShell";
import { requireTesting } from "../requireTesting";
import { ImportPanel } from "./ImportPanel";

export const metadata: Metadata = {
  title: "Import bugs",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /testing/import — for whoever would rather work in a spreadsheet than a
 * form. Fill in the template offline, drop it here, look at what it would
 * do, then apply it.
 *
 * Status is deliberately not importable. Which moves are available depends
 * on who you are, and a spreadsheet column is the wrong place to find that
 * out; the table offers only the moves you actually have.
 */
export default async function ImportPage() {
  const { avatarUrl } = await requireTesting("/testing/import");

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Import bugs
      </h1>

      <ImportPanel />

      <div className="mt-10 space-y-3 text-sm leading-relaxed text-zinc-500">
        <p>
          Leave the id column empty to file something new. Keep the id from
          an exported file to change that bug instead, so a round trip edits
          rather than duplicates.
        </p>
        <p>
          Severity, kind and area accept either the short word or the label
          the export writes, so major and Major both work, as do match and
          The match page. Time in the video takes 2:12 or 132.
        </p>
        <p>
          Nothing is written while any row has a problem. Half an import is
          worse than none, because you cannot tell what landed without
          checking every row.
        </p>
      </div>
    </AppShell>
  );
}
