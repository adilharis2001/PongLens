import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { StudentView } from "./StudentView";

export const metadata: Metadata = {
  title: "Student",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One student's page: journal entries about them, the matches they share,
 * and the invite that links them when they are not on PongLens yet. RLS
 * answers whose roster row this is — a row the caller cannot read is a
 * 404, never a hint that it exists.
 */
export default async function StudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/students");

  const { data: student } = await supabase
    .from("coach_students")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!student || student.archived_at) notFound();

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <StudentView userId={user.id} initialStudent={student} />
    </AppShell>
  );
}
