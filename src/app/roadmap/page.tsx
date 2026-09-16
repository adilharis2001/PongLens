import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { RoadmapSections } from "@/components/Roadmap";
import type { RoadmapItem } from "@/lib/roadmap";

export const metadata: Metadata = {
  title: "Roadmap · PongLens",
  description: "What PongLens is building, what comes next, and what has shipped.",
  alternates: { canonical: "/roadmap" },
  openGraph: {
    title: "Roadmap · PongLens",
    description: "What PongLens is building, what comes next, and what has shipped.",
    url: "/roadmap",
    siteName: "PongLens",
    images: ["/img/og.jpg"],
  },
};

// Public, so it is fetched on every request rather than at build time:
// Adil edits it from the admin page and the page should say so at once.
export const dynamic = "force-dynamic";

/**
 * The public roadmap, for anyone with the link. The same list a
 * signed-in player sees on the board's Roadmap tab; this one needs no
 * account, so it can be sent to someone deciding whether to upload their
 * first match.
 */
export default async function RoadmapPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("roadmap_items")
    .select("*")
    .order("stage")
    .order("position");
  const items = (data ?? []) as RoadmapItem[];

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Roadmap</h1>
          <p className="mt-2 text-zinc-400">
            What is being built, what comes next, and what has shipped.
          </p>
          <div className="mt-10">
            <RoadmapSections items={items} />
          </div>
          <p className="mt-12 text-sm text-zinc-500">
            Signed-in players vote on what comes next. Have an idea, or found a
            bug? Post it on the{" "}
            <Link
              href="/feedback"
              className="font-medium text-zinc-300 underline decoration-edge underline-offset-4 transition-colors hover:text-white"
            >
              feedback board
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
