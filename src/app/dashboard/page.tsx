import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { SignOutButton } from "./SignOutButton";
import { UploadCard } from "./UploadCard";
import { JobsList } from "./JobsList";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email ??
    "player";
  const firstName = name.split(" ")[0];
  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-edge/70 bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-4">
            {avatarUrl && (
              <Image
                src={avatarUrl}
                alt=""
                width={32}
                height={32}
                unoptimized
                className="rounded-full border border-edge"
              />
            )}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="bg-arena flex-1">
        <div className="mx-auto max-w-4xl px-6 py-12">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Hey {firstName} 👋
          </h1>
          <p className="mt-2 text-zinc-400">
            Upload a match, then check back — most videos finish processing in
            under 30 minutes.
          </p>

          <div className="mt-10">
            <UploadCard userId={user.id} />
          </div>

          <div className="mt-12">
            <JobsList />
          </div>
        </div>
      </main>
    </>
  );
}
