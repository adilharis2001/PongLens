import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/config";
import { reconcileIosBetaRequest } from "@/lib/email/iosBetaEmails";
import { handleBetaAdminReconcile } from "@/lib/iosBeta/adminReconcile";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  return handleBetaAdminReconcile(request, {
    async admin() {
      const db = await createClient();
      const {
        data: { user },
        error,
      } = await db.auth.getUser();
      return !error && !!user && isAdminEmail(user.email);
    },
    reconcile: reconcileIosBetaRequest,
  });
}
