import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "./requireAdmin";
import { SectionHeading } from "@/components/SectionHeading";
import {
  ADMIN_PAGES,
  ADMIN_WORKSPACES,
  hubDetail,
  type PortalCounts,
} from "./adminPageView";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * The admin hub: one card per subpage, with pending work surfaced so a
 * glance says whether anything needs attention. The sections themselves
 * live at /admin/access, /admin/storage, /admin/players, /admin/costs.
 */
export default async function AdminPage() {
  const { supabase, avatarUrl } = await requireAdmin();
  const [{ data }, { count: backlogOpen }] = await Promise.all([
    supabase.rpc("admin_portal_counts"),
    supabase
      .from("backlog_items")
      .select("id", { count: "exact", head: true })
      .neq("lane", "done"),
  ]);
  const counts = (data as PortalCounts | null) ?? null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin</h1>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {ADMIN_PAGES.map((page) => {
          const detail = hubDetail(page.key, counts, backlogOpen);
          return (
            <li key={page.key}>
              <Link
                href={page.href}
                className="group flex h-full items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-5 transition-colors hover:border-cyan-glow/40"
              >
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-zinc-100">
                    {page.title}
                  </span>
                  {detail && (
                    <span
                      className={`mt-1 block truncate text-sm ${
                        detail.attention ? "text-cyan-glow" : "text-zinc-500"
                      }`}
                    >
                      {detail.text}
                    </span>
                  )}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-cyan-glow"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m9 6 6 6-6 6"
                  />
                </svg>
              </Link>
            </li>
          );
        })}
      </ul>

      <SectionHeading className="mt-10">Workspaces</SectionHeading>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {ADMIN_WORKSPACES.map((workspace) => (
          <li key={workspace.key}>
            <Link
              href={workspace.href}
              className="group flex h-full items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-5 transition-colors hover:border-cyan-glow/40"
            >
              <span className="block text-base font-semibold text-zinc-100">
                {workspace.title}
              </span>
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-cyan-glow"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m9 6 6 6-6 6"
                />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
