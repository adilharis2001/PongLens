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

function emailShell(body: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#08090f;color:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden">PongLens for iPhone</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#08090f">
      <tr><td align="center" style="padding:36px 16px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border:1px solid #252833;border-radius:20px;background:#101119">
          <tr><td style="padding:32px">
            <div style="margin-bottom:28px;font-size:20px;font-weight:700;color:#ffffff">Pong<span style="color:#2ac7e5">Lens</span></div>
            ${body}
            <p style="margin:28px 0 0;color:#71717a;font-size:12px;line-height:1.6">PongLens · Competitive table tennis, made visible.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function testerEmailContent(testFlightUrl: string): {
  subject: string;
  html: string;
} {
  const safeUrl = escapeBetaHtml(testFlightUrl);
  return {
    subject: "Your PongLens iPhone beta is ready",
    html: emailShell(`
      <p style="margin:0 0 8px;color:#2ac7e5;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase">PongLens for iPhone</p>
      <h1 style="margin:0 0 14px;color:#ffffff;font-size:28px;line-height:1.2">Your beta is ready.</h1>
      <p style="margin:0 0 24px;color:#c4c4cc;font-size:16px;line-height:1.65">Open the invitation on your iPhone to start using PongLens through TestFlight.</p>
      <a href="${safeUrl}" style="display:inline-block;border-radius:999px;background:#2ac7e5;color:#071016;text-decoration:none;font-size:15px;font-weight:700;padding:14px 22px">Open PongLens in TestFlight</a>
      <div style="margin-top:28px;border-top:1px solid #252833;padding-top:22px">
        <p style="margin:0 0 12px;color:#ffffff;font-size:14px;font-weight:700">Getting set up</p>
        <ol style="margin:0;padding-left:20px;color:#a1a1aa;font-size:14px;line-height:1.8">
          <li>Install TestFlight from the App Store if you do not have it.</li>
          <li>Open this invitation on the iPhone you want to use.</li>
          <li>Tap Accept, then Install.</li>
        </ol>
      </div>
      <p style="margin:22px 0 0;color:#71717a;font-size:12px;line-height:1.6">You requested the PongLens iPhone beta. Beta access and essential beta updates only—never marketing.</p>`),
  };
}

export function adminEmailContent(
  email: string,
  requestedAt: string,
): { subject: string; html: string } {
  return {
    subject: "New PongLens iOS beta request",
    html: emailShell(`
      <p style="margin:0 0 8px;color:#2ac7e5;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase">iOS beta</p>
      <h1 style="margin:0 0 18px;color:#ffffff;font-size:26px;line-height:1.2">A player requested access.</h1>
      <p style="margin:0 0 8px;color:#f4f4f5;font-size:16px;line-height:1.6"><strong>Email:</strong> ${escapeBetaHtml(email)}</p>
      <p style="margin:0;color:#a1a1aa;font-size:14px;line-height:1.6"><strong>Requested:</strong> ${escapeBetaHtml(requestedAt)}</p>
      <p style="margin:22px 0 0;color:#71717a;font-size:12px;line-height:1.6">The TestFlight instructions are sent automatically. No action is required.</p>`),
  };
}
