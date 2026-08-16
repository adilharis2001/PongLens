import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCommerceEnabled } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { BalancesCard } from "@/components/BalancesCard";
import { UploadCard } from "@/app/dashboard/UploadCard";
import { YouTubeImport } from "@/components/YouTubeImport";
import { CameraGuide } from "@/components/CameraGuide";
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
        {/* Points AT the row below; it does not open the guide itself.
            Two controls opening the same sheet is one control too many. */}
        <a
          href="#how-to-record"
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-full text-xs text-zinc-500 outline-none transition-colors hover:text-zinc-300 focus-visible:text-zinc-300"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 shrink-0 text-cyan-glow/70"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8.5A1.5 1.5 0 0 1 5.5 7h1.7l1-1.5h3.6l1 1.5h1.7A1.5 1.5 0 0 1 17 8.5v.4l3-1.6v9.4l-3-1.6v.4A1.5 1.5 0 0 1 15.5 16h-10A1.5 1.5 0 0 1 4 14.5v-6Z"
            />
          </svg>
          <span className="underline decoration-zinc-600 underline-offset-2 group-hover:decoration-cyan-glow/50">
            How to record
          </span>
        </a>
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

        {/* Where to put the camera. Not a third feature card wedged
            between Upload and Import — it is a helper row, and it sits
            with the other page-level information at the bottom. The
            header's "How to record" anchors here. */}
        <div id="how-to-record" className="mt-6 scroll-mt-24">
          <CameraGuide variant="row" />
        </div>

        {/* Same card as the home page: uploads and imports both land in
            storage, so the balances belong to the page, not to one card. */}
        {commerceEnabled && (
          <div className="mt-3">
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
