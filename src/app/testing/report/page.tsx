import type { Metadata } from "next";

import { AppShell } from "@/components/AppShell";
import { requireTesting } from "../requireTesting";
import { ReportForm } from "./ReportForm";

export const metadata: Metadata = {
  title: "Report a bug",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /testing/report — the write surface. ?case=<id> arrives from a library
 * case and prefills the case id and its area.
 *
 * The build SHA is read here rather than in the browser: Vercel sets it
 * server-side on every deploy, and exposing it to the client would need a
 * NEXT_PUBLIC_ variable configured by hand. It is what makes "fixed in"
 * mean something three weeks later.
 */
export default async function ReportBugPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const { case: caseId } = await searchParams;
  const { supabase, user, avatarUrl } = await requireTesting("/testing/report");

  const { data: mode } = await supabase.rpc("current_billing_mode");

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Report a bug
      </h1>

      <ReportForm
        userId={user.id}
        initialCaseId={caseId ?? ""}
        buildSha={process.env.VERCEL_GIT_COMMIT_SHA ?? null}
        billingMode={mode === "test" || mode === "live" ? mode : null}
      />
    </AppShell>
  );
}
