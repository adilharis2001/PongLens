import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AdminHeader } from "../../AdminHeader";
import { ProcessingSection } from "../ProcessingSection";
import { previewOverview } from "./fixtures";

export const dynamic = "force-dynamic";

/**
 * Dev-only rendering of /admin/processing from fixtures, one scene per
 * query value: ?scene=standby (default), running, starting, off. It
 * exists so the page's cloud states can be looked at and screenshotted
 * without a live outage and without signing in as the admin. Never
 * served in production.
 */
export default async function ProcessingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ scene?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { scene } = await searchParams;
  return (
    <AppShell avatarUrl={null}>
      <AdminHeader title="Processing" />
      <div className="mt-6">
        <ProcessingSection initial={previewOverview(scene ?? "standby")} frozen />
      </div>
    </AppShell>
  );
}
