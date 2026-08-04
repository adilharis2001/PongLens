import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { AdminHeader } from "../AdminHeader";
import { AccessRequestsSection } from "../AccessRequestsSection";
import { InviteCodesSection } from "../InviteCodesSection";

export const metadata: Metadata = {
  title: "Access",
  robots: { index: false, follow: false },
};

export default async function AdminAccessPage() {
  const { avatarUrl } = await requireAdmin();
  return (
    <AppShell avatarUrl={avatarUrl}>
      <AdminHeader title="Access" />
      <div className="mt-8">
        <AccessRequestsSection />
      </div>
      <div className="mt-12">
        <InviteCodesSection />
      </div>
    </AppShell>
  );
}
