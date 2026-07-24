import type { Metadata } from "next";
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
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Upload</h1>
      <p className="mt-2 text-zinc-400">
        Pick a video and we take it from there. You get an email when it is
        ready.
      </p>

      <CameraGuide className="mt-2.5" />

      <div className="mt-7">
        <UploadCard userId={user.id} />
      </div>

      <div className="mt-6">
        <YouTubeImport />
      </div>
    </AppShell>
  );
}
