import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { getSupportEmail } from "@/lib/config";
import { AccessRequestsSection } from "./AccessRequestsSection";
import { CostDashboardSection } from "./CostDashboardSection";
import { InviteCodesSection } from "./InviteCodesSection";
import { StorageAdminSection } from "./StorageAdminSection";
import {
  ADMIN_SECTION_ORDER,
  type AdminSection,
} from "./adminPageView";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * The admin portal, owner only. The email check here matches is_admin()
 * server-side: every RPC and RLS policy this page's components touch
 * re-checks it, so the redirect is UX, not the security boundary.
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const adminEmail = await getSupportEmail();
  if (user.email !== adminEmail) redirect("/dashboard");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;
  const sections: Record<AdminSection, ReactNode> = {
    accessRequests: <AccessRequestsSection />,
    inviteCodes: <InviteCodesSection />,
    storage: <StorageAdminSection />,
    platformCosts: <CostDashboardSection />,
  };

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Invite codes, storage, quota requests, and platform costs.
      </p>

      {ADMIN_SECTION_ORDER.map((section, index) => (
        <div key={section} className={index === 0 ? "mt-8" : "mt-12"}>
          {sections[section]}
        </div>
      ))}
    </AppShell>
  );
}
