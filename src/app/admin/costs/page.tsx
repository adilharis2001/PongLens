import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { AdminHeader } from "../AdminHeader";
import { CostDashboardSection } from "../CostDashboardSection";

export const metadata: Metadata = {
  title: "Platform costs",
  robots: { index: false, follow: false },
};

export default async function AdminCostsPage() {
  const { avatarUrl } = await requireAdmin();
  return (
    <AppShell avatarUrl={avatarUrl}>
      <AdminHeader title="Platform costs" />
      <div className="mt-6">
        <CostDashboardSection />
      </div>
    </AppShell>
  );
}
