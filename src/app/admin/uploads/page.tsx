import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { UploadsIndex, type UploadRow } from "./UploadsIndex";

export const metadata: Metadata = {
  title: "Uploads",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminUploadsPage() {
  const { supabase, avatarUrl } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_recent_uploads", {
    p_limit: 60,
  });

  return (
    // AppShell here, not the bare nav the detail page uses: an index is a
    // list, not media, so the padded column is right and there is no
    // takeover to be caught by its entry transform.
    <AppShell avatarUrl={avatarUrl}>
      <UploadsIndex
        rows={(data as UploadRow[] | null) ?? []}
        error={error?.message ?? null}
      />
    </AppShell>
  );
}
