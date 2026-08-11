import { handlePlatformWebhook } from "@/lib/payments/platformWebhook";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handlePlatformWebhook(req);
}
