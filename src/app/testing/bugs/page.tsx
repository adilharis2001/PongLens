import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { requireTesting } from "../requireTesting";
import { BugTable } from "./BugTable";

export const metadata: Metadata = {
  title: "Bugs",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /testing/bugs — the shared queue. Both audiences see every row; what
 * differs is which statuses each may set, which src/lib/qa/bugs.ts decides
 * and the two update policies in 104 enforce.
 *
 * Read directly from the table under RLS rather than through an RPC: the
 * select policy is already the boundary, and the table is the one surface
 * where filtering client-side keeps the interaction instant.
 */
export default async function BugsPage() {
  const { user, isAdmin, avatarUrl } = await requireTesting("/testing/bugs");

  return (
    <AppShell avatarUrl={avatarUrl} wide>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bugs</h1>
        <Link
          href="/testing/report"
          className="rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink"
        >
          Report a bug
        </Link>
      </div>

      <BugTable isAdmin={isAdmin} userId={user.id} />
    </AppShell>
  );
}
