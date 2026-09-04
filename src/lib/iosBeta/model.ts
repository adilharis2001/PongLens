import {
  betaAdminNoticeEmail,
  betaInvitationEmail,
} from "../email/catalog.ts";
import type { EmailMessage, RenderedEmail } from "../email/message.ts";
import { renderEmail } from "../email/render.ts";

const EMAIL_MAX_LENGTH = 254;

export function escapeBetaHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "'":
        return "&#39;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}

export function normalizeBetaEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX_LENGTH) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const [local, domain] = email.split("@");
  if (!local || local.length > 64 || !domain || domain.length > 253) return null;
  return email;
}

export function parseTestFlightUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "testflight.apple.com") {
      return null;
    }
    if (!/^\/join\/[A-Za-z0-9]+\/?$/.test(url.pathname)) return null;
    if (url.username || url.password || url.port || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function testerEmailMessage(testFlightUrl: string): EmailMessage {
  return betaInvitationEmail(testFlightUrl);
}

export function testerEmailContent(testFlightUrl: string): RenderedEmail {
  return renderEmail(testerEmailMessage(testFlightUrl));
}

export function adminEmailMessage(
  email: string,
  requestedAt: string,
): EmailMessage {
  return betaAdminNoticeEmail({ email, requestedAt });
}

export function adminEmailContent(
  email: string,
  requestedAt: string,
): RenderedEmail {
  return renderEmail(adminEmailMessage(email, requestedAt));
}
