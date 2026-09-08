import { adminVersionRoute } from "@/lib/matchIssues/adminReprocessRoute";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ issueId: string }> }) {
  return adminVersionRoute(request, (await context.params).issueId, "reprocess");
}
