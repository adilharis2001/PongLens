import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="bg-arena flex flex-1 items-center justify-center px-6 py-24">
        <div className="mx-auto max-w-md text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-glow">
            404
          </p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            This page is off the table
          </h1>
          <p className="mt-4 leading-relaxed text-zinc-400">
            The page you&apos;re looking for doesn&apos;t exist or has moved.
          </p>
          <div className="mt-8">
            <Link
              href="/"
              className="glow-cta inline-block rounded-full bg-cyan-glow px-8 py-3 text-base font-semibold text-ink"
            >
              Back to home
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
