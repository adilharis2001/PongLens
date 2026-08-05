import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { SampleFinding } from "./SampleFinding";

export const metadata: Metadata = {
  title: "A real review",
  robots: { index: false, follow: false },
};

/**
 * The featured sample review: a completed, student-approved review shown
 * publicly with the student's identity stripped. Nothing sells an async
 * review like reading one. resolve_sample_review() is the whole gate —
 * it returns nothing unless consent is approved and the page published.
 */

interface SamplePoint {
  clip_path: string | null;
  display_no: number;
}

interface SampleFindingRow {
  id: string;
  title: string;
  body: string;
  audio_path: string | null;
  image_path: string | null;
  points: SamplePoint[];
}

interface SampleReview {
  coach_name: string;
  handle: string;
  offering_title: string;
  sections: { key: string; label: string; body: string }[];
  findings: SampleFindingRow[];
}

export default async function SampleReviewPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/i.test(handle)) notFound();

  const supabase = await createClient();
  const { data } = await supabase.rpc("resolve_sample_review", {
    p_handle: handle.toLowerCase(),
  });
  const sample = data as SampleReview | null;
  if (!sample) notFound();

  // Presign everything up front; the page is one deliverable, not a feed.
  const sign = async (path: string | null): Promise<string | null> => {
    const m = path?.match(/^r2:\/\/ponglens-media\/(.+)$/);
    if (!m) return null;
    try {
      return await presignGet(MEDIA_BUCKET, m[1], { expiresSeconds: 3600 });
    } catch {
      return null;
    }
  };
  const findings = await Promise.all(
    sample.findings.map(async (f) => ({
      id: f.id,
      title: f.title,
      body: f.body,
      audioUrl: await sign(f.audio_path),
      imageUrl: await sign(f.image_path),
      points: await Promise.all(
        f.points.map(async (p) => ({
          displayNo: p.display_no,
          clipUrl: await sign(p.clip_path),
        })),
      ),
    })),
  );

  const filled = sample.sections.filter((s) => s.body?.trim());

  return (
    <div className="flex min-h-dvh flex-col bg-arena">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-24 pt-10 sm:px-6 md:pt-16">
        <Link
          href={`/coach/${sample.handle}`}
          className="text-xs font-medium text-zinc-500 hover:text-zinc-300"
        >
          ← {sample.coach_name}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          A real review
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {sample.offering_title} by {sample.coach_name}, shared with the
          player&apos;s permission.
        </p>

        <div className="mt-8 space-y-8">
          {filled.map((s) => (
            <section key={s.key}>
              <h2 className="text-lg font-semibold tracking-tight">
                {s.label}
              </h2>
              <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">
                {s.body}
              </p>
            </section>
          ))}

          {findings.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold tracking-tight">
                Watch these points
              </h2>
              <div className="mt-3 space-y-4">
                {findings.map((f) => (
                  <SampleFinding key={f.id} finding={f} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="mt-12 rounded-2xl border border-edge bg-surface p-5 text-center">
          <p className="text-sm text-zinc-300">
            Your match could read like this.
          </p>
          <Link
            href={`/coach/${sample.handle}`}
            className="glow-cta mt-4 inline-block rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink"
          >
            See {sample.coach_name}&apos;s reviews
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
