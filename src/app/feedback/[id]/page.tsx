import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { FeedbackThread } from "./FeedbackThread";

export const metadata: Metadata = {
  title: "Feedback and discussion",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One board post and its thread. The bell links here
 * (`/feedback/<id>`, written by feedback_post_comment), and so does every
 * row on the board.
 */
export default async function FeedbackItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

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
  const { data: isAdmin } = await supabase.rpc("is_admin");

  return (
    <AppShell avatarUrl={avatarUrl}>
      <FeedbackThread itemId={id.toLowerCase()} userId={user.id} isAdmin={isAdmin === true} />
    </AppShell>
  );
}
