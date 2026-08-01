import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResearchDashboard } from "./ResearchDashboard";
import {
  RESEARCH_PAGES,
  hasResearchDashboardAccess,
} from "./researchDashboardModel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Research",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ResearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research");

  const [adminResult, reviewerResult] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase
      .from("research_reviewers")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const reviewerActive =
    !reviewerResult.error && reviewerResult.data?.active === true;
  if (
    !hasResearchDashboardAccess(
      adminResult.data === true,
      reviewerActive,
    )
  ) {
    notFound();
  }

  return <ResearchDashboard pages={RESEARCH_PAGES} />;
}
