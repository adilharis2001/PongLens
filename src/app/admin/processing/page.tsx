import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { AdminHeader } from "../AdminHeader";
import { ProcessingSection } from "./ProcessingSection";

export const metadata: Metadata = {
  title: "Processing",
  robots: { index: false, follow: false },
};

/**
 * What the workers are doing right now. The only place that answers
 * whether the Mac Studio is alive, what it is working on, who is waiting
 * behind it, and whether the cloud twin is switched on.
 *
 * Read-only by design. Adil asked to SEE the worker; a pause or retry
 * button on numbers nobody has watched yet is a separate conversation.
 */
export default async function AdminProcessingPage() {
  const { avatarUrl } = await requireAdmin();
  return (
    <AppShell avatarUrl={avatarUrl}>
      <AdminHeader title="Processing" />
      <div className="mt-6">
        <ProcessingSection />
      </div>
    </AppShell>
  );
}
