import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { AdminHeader } from "../AdminHeader";
import { StorageAdminSection } from "../StorageAdminSection";

export const metadata: Metadata = {
  title: "Storage",
  robots: { index: false, follow: false },
};

export default async function AdminStoragePage() {
  const { avatarUrl } = await requireAdmin();
  return (
    <AppShell avatarUrl={avatarUrl}>
      <AdminHeader title="Storage" />
      <div className="mt-6">
        <StorageAdminSection />
      </div>
    </AppShell>
  );
}
