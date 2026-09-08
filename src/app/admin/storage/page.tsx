import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "../requireAdmin";

export const metadata: Metadata = {
  title: "Storage",
  robots: { index: false, follow: false },
};

export default async function AdminStoragePage() {
  await requireAdmin();
  redirect("/admin/commerce#requests");
}
