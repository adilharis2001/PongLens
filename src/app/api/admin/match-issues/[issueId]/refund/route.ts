import { isAdminEmail } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { handleAdminRefund } from "@/lib/matchIssues/adminActions";
import { sendPendingMatchIssueEmails } from "@/lib/matchIssues/email";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await context.params;
  const supabase = await createClient();
  return handleAdminRefund(request, issueId, {
    async authenticate() {
      const { data: { user } } = await supabase.auth.getUser();
      return user ? { userId: user.id, isAdmin: isAdminEmail(user.email) } : null;
    },
    async refund(id, playerNote, internalNote) {
      return supabase.rpc("admin_refund_match_issue", { p_issue_id: id, p_player_note: playerNote, p_internal_note: internalNote });
    },
    async loadDetail(id) { return supabase.rpc("admin_match_issue_detail", { p_issue_id: id }); },
    sendEmail: sendPendingMatchIssueEmails,
    reportError: message => console.error(message),
  });
}
