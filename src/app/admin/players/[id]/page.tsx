import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../../requireAdmin";
import { PlayerDetailSection } from "./PlayerDetailSection";

export const metadata: Metadata = {
  title: "Player",
  robots: { index: false, follow: false },
};

export default async function AdminPlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { avatarUrl } = await requireAdmin();
  return (
    <AppShell avatarUrl={avatarUrl}>
      <PlayerDetailSection userId={id} />
    </AppShell>
  );
}
