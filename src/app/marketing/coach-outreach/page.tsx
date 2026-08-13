import type { Metadata } from "next";
import { LocalTime } from "@/components/LocalTime";
import { Logo } from "@/components/Logo";
import { UpLink } from "@/components/UpLink";
import { requireMarketing } from "../requireMarketing";
import { OutreachList } from "./OutreachList";
import type { OutreachCoach } from "./outreachModel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Coach outreach",
  robots: { index: false, follow: false, nocache: true },
};

interface RunRow {
  agent: string;
  status: string;
  found: number;
  added: number;
  cost_usd: string | number;
  started_at: string;
}

/**
 * /marketing/coach-outreach — the pipeline. Same gate as the hub.
 *
 * Coaches and their channels come back in one request through the foreign
 * key, and the ordering puts English first because that is where the
 * outreach starts. Everyone else stays in the list rather than being
 * filtered out of the query: a German coach found today is one we do not
 * have to find again later.
 */
export default async function CoachOutreachPage() {
  const { supabase } = await requireMarketing("/marketing/coach-outreach");

  const [coachResult, runResult] = await Promise.all([
    supabase
      .from("outreach_coaches")
      // "*" carries the generated region and payments_supported columns (105)
      // along with everything else, so the shape stays in one place.
      .select("*, outreach_channels (kind, value, source)")
      // Coaches the product could actually take money from come first. Inside
      // that, the ones writing in English, then reach.
      .order("payments_supported", { ascending: false })
      .order("english", { ascending: false })
      .order("followers", { ascending: false })
      .limit(500),
    supabase
      .from("outreach_runs")
      .select("agent, status, found, added, cost_usd, started_at")
      .eq("agent", "discover")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const coaches = (coachResult.data as OutreachCoach[] | null) ?? [];
  const run = (runResult.data as RunRow | null) ?? null;

  return (
    <div className="bg-arena relative min-h-screen overflow-hidden">
      <header className="relative mx-auto flex max-w-5xl items-center px-6 py-6 sm:px-8">
        <Logo href="/dashboard" />
      </header>

      <main className="relative mx-auto max-w-5xl px-6 pb-16 pt-6 sm:px-8 sm:pb-24 sm:pt-8">
        <UpLink href="/marketing" label="Marketing" />
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Coach outreach
        </h1>

        <OutreachList coaches={coaches} />

        {run && (
          <p className="mt-10 text-xs leading-5 text-zinc-600">
            Last discovery run <LocalTime iso={run.started_at} />: {run.status},{" "}
            {run.found} profiles seen, {run.added} written, $
            {Number(run.cost_usd).toFixed(2)} spent.
          </p>
        )}
      </main>
    </div>
  );
}
