import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { AdminHeader } from "../AdminHeader";
import { OutreachSection } from "./OutreachSection";

export const metadata: Metadata = {
  title: "Outreach",
  robots: { index: false, follow: false },
};

export default async function AdminOutreachPage() {
  const { avatarUrl } = await requireAdmin();
  return (
    <AppShell avatarUrl={avatarUrl}>
      <AdminHeader title="Outreach and feedback" />
      <div className="mt-6">
        <OutreachSection />
      </div>
    </AppShell>
  );
}
