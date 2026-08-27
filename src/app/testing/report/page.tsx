import type { Metadata } from "next";

import { AppShell } from "@/components/AppShell";
import { TEST_SURFACES } from "@/lib/qa/testLibrary";
import { requireTesting } from "../requireTesting";
import { ReportForm, type MatchOption } from "./ReportForm";

export const metadata: Metadata = {
  title: "Report a bug",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /testing/report — the write surface. ?case=<id> arrives from a library
 * case and prefills the case id and its area; ?match=<uuid> arrives from
 * anywhere that already knows which match is being looked at.
 *
 * The build SHA is read here rather than in the browser: Vercel sets it
 * server-side on every deploy, and exposing it to the client would need a
 * NEXT_PUBLIC_ variable configured by hand. It is what makes "fixed in"
 * mean something three weeks later.
 *
 * The match list is fetched here too. It used to be a uuid text box, and
 * a tester with no way to know what a match id looks like pasted a token
 * off the network tab and got "Try again" for their trouble. RLS already
 * limits this to the reader's own matches, so the list is both the answer
 * to "where do I find it" and a guarantee the id exists.
 */
export default async function ReportBugPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string; match?: string; surface?: string }>;
}) {
  const { case: caseId, match, surface } = await searchParams;
  const { supabase, user, avatarUrl } = await requireTesting("/testing/report");

  const [{ data: mode }, { data: matches }] = await Promise.all([
    supabase.rpc("current_billing_mode"),
    supabase
      .from("matches")
      .select("id, played_at, created_at, opponent_name, status")
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Report a bug
      </h1>

      <ReportForm
        userId={user.id}
        initialCaseId={caseId ?? ""}
        initialMatchId={match ?? ""}
        initialSurface={
          TEST_SURFACES.find((s) => s.key === surface)?.key ?? null
        }
        matches={(matches ?? []) as MatchOption[]}
        buildSha={process.env.VERCEL_GIT_COMMIT_SHA ?? null}
        billingMode={mode === "test" || mode === "live" ? mode : null}
      />
    </AppShell>
  );
}
