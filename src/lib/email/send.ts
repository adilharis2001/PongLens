import type { EmailMessage } from "./message.ts";
import { renderEmail } from "./render.ts";

export const EMAIL_FROM = "PongLens <support@ponglens.com>";
export const EMAIL_REPLY_TO = "support@ponglens.com";

export type EmailSendState = "sent" | "suppressed" | "failed";

export type EmailDeliveryDependencies = {
  apiKey: string;
  isSuppressed(to: string, context: string): Promise<boolean>;
  fetch: typeof fetch;
  record(
    messageId: string,
    operation: string,
    message: EmailMessage,
  ): Promise<void>;
  reportError?(message: string): void;
};

type SendTransactionalEmailInput = {
  to: string;
  message: EmailMessage;
  idempotencyKey: string;
  operation: string;
  suppression?: boolean;
  timeoutMs?: number;
};

async function defaultDependencies(): Promise<EmailDeliveryDependencies> {
  const [{ skipIfSuppressed }, { recordUsage, resendEmailEvent }] =
    await Promise.all([import("./suppression.ts"), import("../costs/meter.ts")]);
  return {
    apiKey: process.env.RESEND_API_KEY ?? "",
    isSuppressed: skipIfSuppressed,
    fetch,
    async record(messageId, operation, message) {
      await recordUsage(
        [
          resendEmailEvent({
            messageId,
            operation: `${operation}:${message.templateId}:v${message.templateVersion}`,
          }),
        ].filter((event) => event !== null),
      );
    },
    reportError(message) {
      console.error(message);
    },
  };
}

export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput,
  provided?: EmailDeliveryDependencies,
): Promise<EmailSendState> {
  if (
    input.idempotencyKey.length < 1 ||
    input.idempotencyKey.length > 256
  ) {
    throw new Error("Invalid Resend idempotency key");
  }
  const dependencies = provided ?? (await defaultDependencies());
  if (!dependencies.apiKey) {
    dependencies.reportError?.(
      `Email skipped because RESEND_API_KEY is missing: ${input.message.templateId}`,
    );
    return "failed";
  }
  if (
    input.suppression !== false &&
    (await dependencies.isSuppressed(input.to, input.message.templateId))
  ) {
    return "suppressed";
  }

  const rendered = renderEmail(input.message);
  try {
    const response = await dependencies.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dependencies.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [input.to],
        reply_to: EMAIL_REPLY_TO,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: {
          "X-PongLens-Template-Id": rendered.templateId,
          "X-PongLens-Template-Version": String(rendered.templateVersion),
        },
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 8_000),
    });
    if (!response.ok) {
      dependencies.reportError?.(
        `Email provider returned ${response.status}: ${input.message.templateId}`,
      );
      return "failed";
    }
    const body = (await response.json().catch(() => null)) as {
      id?: string;
    } | null;
    if (body?.id) {
      await dependencies.record(body.id, input.operation, input.message);
    }
    return "sent";
  } catch (error) {
    dependencies.reportError?.(
      `Email delivery failed for ${input.message.templateId}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return "failed";
  }
}

