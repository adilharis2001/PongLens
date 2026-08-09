import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SHARE_VIDEOS } from "@/lib/videos";

export const metadata: Metadata = {
  title: "Videos",
  robots: { index: false, follow: false },
};

/**
 * The index of shareable cuts. Unlisted like the pages it links to, and
 * linked from nowhere: this is a place to find a URL to paste, not a page
 * anyone is meant to arrive at.
 */
export default function VideosPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-4xl px-6">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Videos
            </h1>

            {SHARE_VIDEOS.length === 0 ? (
              <p className="mt-8 text-sm text-zinc-500">No videos yet.</p>
            ) : (
              <div className="mt-10 space-y-4">
                {SHARE_VIDEOS.map((v) => (
                  <Link
                    key={v.slug}
                    href={`/videos/${v.slug}`}
                    className="group flex gap-5 rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40 sm:p-5"
                  >
                    {/* The poster is the video's title card, so at this size
                        it reads as the brand rather than as a thumbnail of
                        nothing in particular. */}
                    <Image
                      src={v.cuts.desktop.poster}
                      alt=""
                      width={1920}
                      height={1080}
                      className="hidden h-auto w-40 shrink-0 rounded-xl border border-edge object-cover sm:block"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-4">
                        <span className="text-lg font-semibold text-zinc-100 transition-colors group-hover:text-cyan-glow">
                          {v.title}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-zinc-500">
                          {v.length}
                        </span>
                      </span>
                      <span className="mt-1.5 block text-sm leading-relaxed text-zinc-400">
                        {v.blurb}
                      </span>
                      <span className="mt-3 block truncate font-mono text-xs text-zinc-600">
                        ponglens.com/videos/{v.slug}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
