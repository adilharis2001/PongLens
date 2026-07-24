import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { UploadCard } from "@/app/dashboard/UploadCard";
import { YouTubeImport } from "@/components/YouTubeImport";
import { CameraGuide } from "@/components/CameraGuide";

export const metadata: Metadata = {
  title: "Upload",
  robots: { index: false, follow: false },
};

export default async function UploadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Upload</h1>
        <CameraGuide className="shrink-0" />
      </div>
      <p className="mt-2 text-zinc-400">
        Pick a video and we take it from there. You get an email when it is
        ready.
      </p>

      <div className="mt-7">
        <UploadCard userId={user.id} />
      </div>

      <div className="mt-6">
        <YouTubeImport userId={user.id} />
      </div>

      {/* Quiet, always-available way to flag something that looks off. Same
          understated language as the "How to record" affordance — a hint, not
          a button. No match to pre-select yet, so it opens the feedback form
          where they can choose one (or a general topic). */}
      <div className="mt-8 border-t border-edge/60 pt-5">
        <Link
          href="/feedback"
          className="group inline-flex items-center gap-1.5 rounded-full text-xs text-zinc-500 outline-none transition-colors hover:text-zinc-300 focus-visible:text-zinc-300"
        >
          <FlagIcon className="h-3.5 w-3.5 shrink-0 text-cyan-glow/70" />
          <span className="underline decoration-zinc-600 underline-offset-2 group-hover:decoration-cyan-glow/50">
            Something not looking right? Report an issue
          </span>
        </Link>
      </div>
    </AppShell>
  );
}

function FlagIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 21V4m0 1.5s1.5-1.5 4.5-1.5 4.5 1.5 7.5 1.5c1.2 0 2-.3 2-.3v9s-.8.3-2 .3c-3 0-4.5-1.5-7.5-1.5S5 14.5 5 14.5"
      />
    </svg>
  );
}
