import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { AdminHeader } from "../AdminHeader";
import { PlayersSection } from "./PlayersSection";

export const metadata: Metadata = {
  title: "Players",
  robots: { index: false, follow: false },
};

export default async function AdminPlayersPage() {
  const { avatarUrl } = await requireAdmin();
  return (
    <AppShell avatarUrl={avatarUrl}>
      <AdminHeader title="Players" />
      <div className="mt-6">
        <PlayersSection />
      </div>
    </AppShell>
  );
}
