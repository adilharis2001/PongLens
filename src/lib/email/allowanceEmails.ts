import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowanceRequestEmail, type AllowanceResource } from "@/lib/commerce/allowances";
import { sendTransactionalEmail } from "./send";

// Each administrator has a delivery row, so a failed send to one never
// repeats a successful send to the other. The daily sweep retries failures.
export async function sendPendingAllowanceEmails(requestId?: string): Promise<void> {
  const admin = createAdminClient();
  let query = admin.from("allowance_email_deliveries")
    .select("request_id, recipient_id").is("delivered_at", null).limit(20);
  if (requestId) query = query.eq("request_id", requestId);
  const { data: deliveries, error } = await query;
  if (error) throw new Error("Could not read allowance email queue");
  for (const delivery of deliveries ?? []) {
    const [{ data: request }, recipient] = await Promise.all([
      admin.from("quota_requests").select("user_id, resource, message, status").eq("id", delivery.request_id).single(),
      admin.auth.admin.getUserById(delivery.recipient_id),
    ]);
    if (!request || !recipient.data.user?.email) continue;
    // An already-reviewed request needs no reminder.
    let done = request.status !== "pending";
    if (!done) {
      const { data } = await admin.auth.admin.getUserById(request.user_id);
      const player = data.user;
      if (!player?.email) continue;
      const state = await sendTransactionalEmail({
        to: recipient.data.user.email,
        message: allowanceRequestEmail({
          name: player.user_metadata?.full_name || player.user_metadata?.name || player.email,
          email: player.email, resource: request.resource as AllowanceResource, message: request.message,
        }),
        idempotencyKey: `allowance-${delivery.request_id}-${delivery.recipient_id}`,
        operation: "allowance_request_email",
      });
      done = state !== "failed";
    }
    if (done) {
      const { error: stampError } = await admin.from("allowance_email_deliveries")
        .update({ delivered_at: new Date().toISOString() })
        .eq("request_id", delivery.request_id).eq("recipient_id", delivery.recipient_id);
      if (stampError) throw new Error("Could not record allowance email delivery");
    }
  }
}
