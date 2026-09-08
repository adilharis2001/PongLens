import { sendPendingMatchIssueEmails } from "@/lib/matchIssues/email";
import { handleMatchIssueRequest } from "@/lib/matchIssues/request";
import type {
  MatchIssue,
  MatchIssueState,
  MatchIssueSubmission,
} from "@/lib/matchIssues/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function respond(
  request: Request,
  context: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await context.params;
  const supabase = await createClient();
  return handleMatchIssueRequest(request, matchId, {
    async authenticate() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
    async loadState(id) {
      const result = await supabase.rpc("match_issue_state", { p_match_id: id });
      return {
        data: result.data as MatchIssueState | null,
        error: result.error,
      };
    },
    async submit(id, input: MatchIssueSubmission) {
      const result = await supabase.rpc("submit_match_issue", {
        p_match_id: id,
        p_kind: input.kind,
        p_message: input.message,
        p_idempotency_key: input.idempotencyKey,
      });
      return { data: result.data as MatchIssue | null, error: result.error };
    },
    async cancel(issueId) {
      const result = await supabase.rpc("cancel_match_issue", {
        p_issue_id: issueId,
      });
      return { data: result.data as MatchIssue | null, error: result.error };
    },
    sendPendingEmail: sendPendingMatchIssueEmails,
    reportError(message) {
      console.error(message);
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ matchId: string }> },
) {
  return respond(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ matchId: string }> },
) {
  return respond(request, context);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ matchId: string }> },
) {
  return respond(request, context);
}
