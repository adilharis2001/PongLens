import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCommerceEnabled } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { BalancesCard } from "@/components/BalancesCard";
import { UploadCard } from "@/app/dashboard/UploadCard";
import { YouTubeImport } from "@/components/YouTubeImport";
import { CameraGuideFirstRun } from "@/components/CameraGuideFirstRun";
import { CAMERA_GUIDE_METADATA_KEY } from "@/lib/cameraGuideGate";
import { UpLink } from "@/components/UpLink";
import { HideWhileUploading } from "@/components/HideWhileUploading";

export const metadata: Metadata = {
  title: "Upload",
  robots: { index: false, follow: false },
};

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
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
  const commerceEnabled = await getCommerceEnabled();

  // The camera guide opens itself on this page for the first two
  // occasions an account reaches it (src/lib/cameraGuideGate.ts). Both
  // inputs are read here, on the server, so the decision is made in the
  // first client frame rather than after a round trip — otherwise the
  // page paints and a sheet drops onto it a moment later.
  //
  // The match count is the back-fill: an account that already has footage
  // in it has plainly worked out where the camera goes and is seeded
  // straight past both showings. RLS scopes the count to the owner, so no
  // user filter is needed here.
  const { count: matchCount } = await supabase
    .from("matches")
    .select("id", { head: true, count: "exact" });

  return (
    <AppShell avatarUrl={avatarUrl}>
      {/* No subtitle. It used to say "Process it into points whenever you
          like", which was the opposite of what the page did — processing
          started on its own the moment an upload finished. The card now
          carries the toggle and the price, so it explains itself. */}
      {/* A way out. The bottom bar stopped pretending this page is
          Matches, which left a phone with nothing to press. Same UpLink
          the match page uses, so there is one "up" control in the app. */}
      <div className="mb-4 md:hidden">
        <UpLink href="/matches" label="Matches" />
      </div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Upload</h1>
        {/* The one way into the camera guide on this page. It used to
            anchor to a second, full-width copy of the same control at the
            bottom — two entries into one sheet read as two features.

            It also opens itself here, twice, for an account that has not
            met it yet. Tapping the link is always available and never
            counts against those two. */}
        <CameraGuideFirstRun
          userId={user.id}
          seenFromAccount={user.user_metadata?.[CAMERA_GUIDE_METADATA_KEY]}
          hasAnyMatch={(matchCount ?? 0) > 0}
          className="shrink-0"
        />
      </div>

      <div className="mt-7">
        <UploadCard
          userId={user.id}
          commerceEnabled={commerceEnabled}
          orderId={
            commerceEnabled && order && /^[0-9a-f-]{36}$/i.test(order)
              ? order
              : null
          }
        />
      </div>

      {/* Everything below is an exit. While a video is going up, the page
          shows the upload and nothing else. */}
      <HideWhileUploading>
        <div className="mt-6">
          <YouTubeImport userId={user.id} commerceEnabled={commerceEnabled} />
        </div>

        {/* Same card as the home page: uploads and imports both land in
            storage, so the balances belong to the page, not to one card. */}
        {commerceEnabled && (
          <div className="mt-6">
            <BalancesCard />
          </div>
        )}

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
      </HideWhileUploading>
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
