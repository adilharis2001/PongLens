import { isAdminEmail } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { sendPendingMatchIssueEmails } from "./email";
import { handleAdminVersionAction, type AdminVersionAction } from "./adminReprocessActions";

export async function adminVersionRoute(request: Request, issueId: string, action: AdminVersionAction) {
  const supabase = await createClient();
  return handleAdminVersionAction(request, issueId, action, {
    async authenticate() {
      const { data: { user } } = await supabase.auth.getUser();
      return user ? { userId: user.id, isAdmin: isAdminEmail(user.email) } : null;
    },
    async rpc(name, args) { return supabase.rpc(name, args); },
    async loadDetail(id) { return supabase.rpc("admin_match_issue_detail", { p_issue_id: id }); },
    sendEmail: sendPendingMatchIssueEmails,
    reportError: message => console.error(message),
  });
}
