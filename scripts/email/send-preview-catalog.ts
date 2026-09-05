import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ADMIN_EMAILS } from "../../src/lib/config.ts";
import { allEmailPreviews, type EmailPreview } from "./preview-catalog.ts";

const FROM = "PongLens <support@ponglens.com>";
const REPLY_TO = "support@ponglens.com";

export function assertApprovedPreviewRecipient(to: string): void {
  if (!ADMIN_EMAILS.includes(to.trim().toLowerCase())) {
    throw new Error("Samples may only be sent to an approved administrator.");
  }
}

export function previewDelivery(
  preview: EmailPreview,
  index: number,
  total: number,
  batchId: string,
  to: string,
) {
  assertApprovedPreviewRecipient(to);
  return {
    from: FROM,
    replyTo: REPLY_TO,
    to: to.trim().toLowerCase(),
    subject: `[Preview ${index + 1}/${total}] ${preview.subject}`,
    html: preview.html,
    text: preview.text,
    headers: {
      "X-PongLens-Template-Id": preview.templateId,
      "X-PongLens-Template-Version": String(preview.templateVersion),
      "X-PongLens-Preview": "true",
    },
    idempotencyKey: `ponglens-preview/${batchId}/${preview.id}`,
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resendKey(): string {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;
  return execFileSync(
    "security",
    ["find-generic-password", "-a", "openclaw", "-s", "ponglens-resend-key", "-w"],
    { encoding: "utf8" },
  ).trim();
}

async function main(): Promise<void> {
  const to = argument("to");
  if (!to) throw new Error("--to <approved-admin-address> is required");
  assertApprovedPreviewRecipient(to);
  const previews = allEmailPreviews();
  const batchId = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17);
  const dryRun = process.argv.includes("--dry-run");
  const key = dryRun ? "" : resendKey();
  let failures = 0;

  for (const [index, preview] of previews.entries()) {
    const delivery = previewDelivery(preview, index, previews.length, batchId, to);
    if (dryRun) {
      console.log(`${preview.id} dry-run`);
      continue;
    }
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": delivery.idempotencyKey,
        },
        body: JSON.stringify({
          from: delivery.from,
          reply_to: delivery.replyTo,
          to: [delivery.to],
          subject: delivery.subject,
          html: delivery.html,
          text: delivery.text,
          headers: delivery.headers,
        }),
      });
      const body = await response.json() as { id?: string; message?: string };
      if (!response.ok || !body.id) {
        throw new Error(`Resend ${response.status}: ${body.message || "no message id"}`);
      }
      console.log(`${preview.id} ${body.id}`);
    } catch (error) {
      failures += 1;
      console.error(`${preview.id} failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  if (failures) throw new Error(`${failures} preview email${failures === 1 ? "" : "s"} failed`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  await main();
}
