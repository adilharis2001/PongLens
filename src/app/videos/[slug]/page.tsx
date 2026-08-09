import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { LandingVideo } from "@/components/marketing/LandingVideo";
import { SHARE_VIDEOS, shareVideo } from "@/lib/videos";

/** Static: there are two of these and they change when a cut is re-rendered. */
export function generateStaticParams() {
  return SHARE_VIDEOS.map((v) => ({ slug: v.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const video = shareVideo(slug);
  if (!video) return { title: "Video", robots: { index: false, follow: false } };
  return {
    title: video.title,
    description: video.blurb,
    // Unlisted. Anyone with the link can watch; nobody finds it by looking.
    robots: { index: false, follow: false },
    // Still worth having: this is a link that gets pasted into an email or a
    // message, and the unfurl is the first thing the recipient sees.
    openGraph: {
      type: "video.other",
      title: video.title,
      description: video.blurb,
      images: [{ url: video.cuts.desktop.poster }],
    },
    twitter: {
      card: "summary_large_image",
      title: video.title,
      description: video.blurb,
      images: [video.cuts.desktop.poster],
    },
  };
}

/**
 * One video, on its own.
 *
 * The treatment is the /coaches section's, which is the home page's: the
 * same wide column, the same play control above the picture, no border on
 * the box and flat ink either side so the video has no edge. It renders the
 * same LandingVideo component rather than a copy.
 */
export default async function VideoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const video = shareVideo(slug);
  if (!video) notFound();

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="relative overflow-hidden py-10 sm:py-20">
          <div className="relative mx-auto max-w-[1500px] px-4 sm:px-6">
            <h1 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              {video.title}
            </h1>
            <div className="mt-8 sm:mt-12">
              <LandingVideo cuts={video.cuts} length={video.length} />
            </div>
            {SHARE_VIDEOS.length > 1 && (
              <p className="mt-10 text-center">
                <Link
                  href="/videos"
                  className="text-sm text-zinc-500 transition-colors hover:text-cyan-glow"
                >
                  All videos
                </Link>
              </p>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
