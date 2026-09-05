import { OutreachSection } from "@/app/admin/outreach/OutreachSection";
import { AppShell } from "@/components/AppShell";
import { AdminHeader } from "@/app/admin/AdminHeader";
export default function Preview() {
  return (
    <AppShell avatarUrl={null}>
      <AdminHeader title="Outreach and feedback" />
      <div className="mt-6">
        <OutreachSection />
      </div>
    </AppShell>
  );
}
