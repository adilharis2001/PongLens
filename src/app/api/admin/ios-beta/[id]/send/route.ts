import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/config";
import { sendIosBetaInviteNow } from "@/lib/email/iosBetaEmails";
import { handleBetaAdminSend } from "@/lib/iosBeta/adminAction";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleBetaAdminSend(request, id, {
    async admin() {
      const db = await createClient();
      const {
        data: { user },
        error,
      } = await db.auth.getUser();
      return !error && user && isAdminEmail(user.email)
        ? { id: user.id }
        : null;
    },
    send: sendIosBetaInviteNow,
  });
}
