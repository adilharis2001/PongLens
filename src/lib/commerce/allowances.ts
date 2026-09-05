import type { EmailMessage } from "../email/message.ts";

export type AllowanceResource = "storage" | "minutes";

export function allowanceInput(body: unknown): { resource: AllowanceResource; message: string } | null {
  if (!body || typeof body !== "object") return null;
  const { resource, message = "" } = body as Record<string, unknown>;
  if (resource !== "storage" && resource !== "minutes") return null;
  if (typeof message !== "string" || message.length > 1000) return null;
  return { resource, message: message.trim() };
}

export function allowanceRequestEmail(facts: {
  name: string; email: string; resource: AllowanceResource; message: string;
}): EmailMessage {
  const resource = facts.resource === "storage" ? "storage" : "processing minutes";
  return {
    templateId: "beta.allowance-request", templateVersion: 1, category: "beta", audience: "admin",
    subject: `${facts.name} requested more ${resource}`,
    preheader: "Review their request and increase their allowance in Admin.",
    heading: `More ${resource} requested`,
    blocks: [
      { type: "details", rows: [{ label: "Player", value: facts.name }, { label: "Email", value: facts.email }] },
      ...(facts.message ? [{ type: "paragraph" as const, text: facts.message }] : []),
    ],
    action: { label: "Review request", url: "https://www.ponglens.com/admin/commerce#requests" },
    reason: "You receive allowance requests because you are a PongLens administrator.",
  };
}
