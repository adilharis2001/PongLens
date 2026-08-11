import type { Metadata } from "next";

import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { TestingSection, type QaAccount } from "./TestingSection";

export const metadata: Metadata = {
  title: "Testing",
  robots: { index: false, follow: false },
};

/**
 * /admin/testing — the QA setup (092). Two things live here: which
 * accounts carry the QA role (their payments are pinned to test), and
 * the admin account's own live/test toggle. Both are read fresh on every
 * load; the RPCs re-check is_admin() server-side.
 */
export default async function TestingPage() {
  const { supabase, avatarUrl } = await requireAdmin();
  const [{ data: qa }, { data: cfg }] = await Promise.all([
    supabase.rpc("admin_list_qa"),
    supabase
      .from("app_config")
      .select("value")
      .eq("key", "admin_payments_test")
      .maybeSingle(),
  ]);

  return (
    <AppShell avatarUrl={avatarUrl}>
      <TestingSection
        initialAccounts={(qa as QaAccount[] | null) ?? []}
        initialAdminTest={cfg?.value === "true"}
      />
    </AppShell>
  );
}
