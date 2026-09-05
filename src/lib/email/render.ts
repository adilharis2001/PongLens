import type {
  EmailBlock,
  EmailItem,
  EmailMessage,
  RenderedEmail,
} from "./message.ts";

export const EMAIL_COLORS = {
  light: {
    canvas: "#f4f5f7",
    surface: "#ffffff",
    primary: "#111827",
    secondary: "#4b5563",
    muted: "#64748b",
    border: "#e4e4e7",
    inset: "#f8fafc",
  },
  dark: {
    canvas: "#08090f",
    surface: "#101119",
    primary: "#f4f4f5",
    secondary: "#c4c4cc",
    muted: "#a1a1aa",
    border: "#3f3f46",
    inset: "#181922",
  },
  accent: "#2ac7e5",
  actionText: "#071016",
} as const;

const SUPPORT_EMAIL = "support@ponglens.com";
const ALLOWED_HOSTS = new Set([
  "ponglens.com",
  "www.ponglens.com",
  "testflight.apple.com",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isAllowedEmailUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
      return false;
    }
    if (url.hostname === "testflight.apple.com") {
      return /^\/join\/[A-Za-z0-9]+\/?$/.test(url.pathname);
    }
    return true;
  } catch {
    return false;
  }
}

function approvedUrl(value: string): string {
  if (!isAllowedEmailUrl(value)) {
    throw new Error(`URL is not an approved email destination: ${value}`);
  }
  return escapeHtml(value);
}

function itemHtml(item: EmailItem): string {
  const title = item.url
    ? `<a class="email-link" href="${approvedUrl(item.url)}" style="color:${EMAIL_COLORS.accent};text-decoration:none;font-weight:700;">${escapeHtml(item.title)}</a>`
    : `<span class="primary-text" style="color:${EMAIL_COLORS.light.primary};font-weight:700;">${escapeHtml(item.title)}</span>`;
  const description = item.description
    ? `<div class="secondary-text" style="margin-top:5px;color:${EMAIL_COLORS.light.secondary};font-size:14px;line-height:1.55;">${escapeHtml(item.description)}</div>`
    : "";
  const meta = item.meta
    ? `<div class="muted-text" style="margin-top:7px;color:${EMAIL_COLORS.light.muted};font-size:12px;line-height:1.5;">${escapeHtml(item.meta)}</div>`
    : "";
  return `<table class="inset-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0;background:${EMAIL_COLORS.light.inset};border:1px solid ${EMAIL_COLORS.light.border};border-radius:12px;"><tr><td style="padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;">${title}${description}${meta}</td></tr></table>`;
}

function blockHtml(block: EmailBlock): string {
  switch (block.type) {
    case "paragraph":
      return `<p class="secondary-text" style="margin:0 0 18px;color:${EMAIL_COLORS.light.secondary};font-size:16px;line-height:1.6;">${escapeHtml(block.text)}</p>`;
    case "steps":
      return `<ol class="secondary-text" style="margin:2px 0 20px;padding-left:22px;color:${EMAIL_COLORS.light.secondary};font-size:15px;line-height:1.65;">${block.items.map((item) => `<li style="margin:7px 0;padding-left:4px;">${escapeHtml(item)}</li>`).join("")}</ol>`;
    case "details":
      return `<table class="details-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;border-top:1px solid ${EMAIL_COLORS.light.border};border-bottom:1px solid ${EMAIL_COLORS.light.border};">${block.rows.map((row) => `<tr><td class="muted-text details-label" style="padding:11px 12px 11px 0;color:${EMAIL_COLORS.light.muted};font-size:13px;line-height:1.45;vertical-align:top;">${escapeHtml(row.label)}</td><td class="primary-text" align="right" style="padding:11px 0 11px 12px;color:${EMAIL_COLORS.light.primary};font-size:13px;line-height:1.45;font-weight:600;vertical-align:top;">${escapeHtml(row.value)}</td></tr>`).join("")}</table>`;
    case "items":
      return `<div style="margin:4px 0 22px;">${block.heading ? `<h2 class="primary-text" style="margin:0 0 4px;color:${EMAIL_COLORS.light.primary};font-size:15px;line-height:1.4;">${escapeHtml(block.heading)}</h2>` : ""}${block.items.map(itemHtml).join("")}</div>`;
    case "diagnostic":
      return `<pre class="diagnostic" style="margin:4px 0 22px;padding:14px 16px;overflow-wrap:anywhere;white-space:pre-wrap;background:${EMAIL_COLORS.light.inset};border:1px solid ${EMAIL_COLORS.light.border};border-radius:12px;color:${EMAIL_COLORS.light.secondary};font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.55;">${escapeHtml(block.text)}</pre>`;
  }
}

function blockText(block: EmailBlock): string {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    case "details":
      return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
    case "items": {
      const rows = block.items.map((item) =>
        [item.title, item.description, item.meta, item.url]
          .filter(Boolean)
          .join("\n"),
      );
      return [block.heading, ...rows].filter(Boolean).join("\n\n");
    }
    case "diagnostic":
      return block.text;
  }
}

export function renderEmail(message: EmailMessage): RenderedEmail {
  if (message.action) approvedUrl(message.action.url);
  for (const block of message.blocks) {
    if (block.type === "items") {
      for (const item of block.items) {
        if (item.url) approvedUrl(item.url);
      }
    }
  }

  const width =
    message.category === "digest" || message.category === "ops" ? 600 : 560;
  const support = message.support !== false;
  const action = message.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;"><tr><td align="center" bgcolor="${EMAIL_COLORS.accent}" style="background:${EMAIL_COLORS.accent};border-radius:999px;"><a href="${approvedUrl(message.action.url)}" style="display:block;box-sizing:border-box;min-height:44px;padding:13px 22px;color:${EMAIL_COLORS.actionText};font-size:15px;line-height:18px;font-weight:750;text-decoration:none;border-radius:999px;">${escapeHtml(message.action.label)}</a></td></tr></table>`
    : "";
  const preheaderPadding = "&nbsp;&zwnj;".repeat(12);
  const title = `${message.subject} | PongLens`;

  const html = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media only screen and (max-width: 480px) {
  .email-card-cell { padding: 24px !important; }
  .details-label { width: 34% !important; }
}
@media (prefers-color-scheme: dark) {
  .email-body, .email-canvas { background-color: ${EMAIL_COLORS.dark.canvas} !important; }
  .email-card { background-color: ${EMAIL_COLORS.dark.surface} !important; border-color: ${EMAIL_COLORS.dark.border} !important; }
  .primary-text { color: ${EMAIL_COLORS.dark.primary} !important; }
  .secondary-text { color: ${EMAIL_COLORS.dark.secondary} !important; }
  .muted-text { color: ${EMAIL_COLORS.dark.muted} !important; }
  .details-table { border-color: ${EMAIL_COLORS.dark.border} !important; }
  .inset-card, .diagnostic { background-color: ${EMAIL_COLORS.dark.inset} !important; border-color: ${EMAIL_COLORS.dark.border} !important; color: ${EMAIL_COLORS.dark.secondary} !important; }
  .email-link { color: ${EMAIL_COLORS.accent} !important; }
}
</style>
</head>
<body class="email-body" style="margin:0;padding:0;background:${EMAIL_COLORS.light.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(message.preheader)}${preheaderPadding}</div>
<table class="email-canvas" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background:${EMAIL_COLORS.light.canvas};">
<tr><td align="center" style="padding:36px 16px;">
<table class="email-card" role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${width}px;background:${EMAIL_COLORS.light.surface};border:1px solid ${EMAIL_COLORS.light.border};border-radius:20px;">
<tr><td class="email-card-cell" style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;"><tr>
<td width="48" style="width:48px;vertical-align:middle;"><img src="https://www.ponglens.com/img/icon-192.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:10px;"></td>
<td style="vertical-align:middle;"><div aria-label="PongLens" style="color:${EMAIL_COLORS.light.primary};font-size:21px;line-height:1;font-weight:800;letter-spacing:-0.03em;"><span class="primary-text">Pong</span><span style="color:${EMAIL_COLORS.accent};">Lens</span></div></td>
</tr></table>
${message.eyebrow ? `<p style="margin:0 0 10px;color:${EMAIL_COLORS.accent};font-size:12px;line-height:1.4;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">${escapeHtml(message.eyebrow)}</p>` : ""}
<h1 class="primary-text" style="margin:0 0 18px;color:${EMAIL_COLORS.light.primary};font-size:28px;line-height:1.2;font-weight:750;letter-spacing:-0.025em;">${escapeHtml(message.heading)}</h1>
${message.blocks.map(blockHtml).join("")}
${action}
<div class="details-table" style="margin-top:30px;padding-top:18px;border-top:1px solid ${EMAIL_COLORS.light.border};">
<p class="muted-text" style="margin:0;color:${EMAIL_COLORS.light.muted};font-size:12px;line-height:1.6;">${escapeHtml(message.reason)}</p>
${support ? `<p class="muted-text" style="margin:7px 0 0;color:${EMAIL_COLORS.light.muted};font-size:12px;line-height:1.6;">Questions? <a class="email-link" href="mailto:${SUPPORT_EMAIL}" style="color:${EMAIL_COLORS.accent};text-decoration:none;">${SUPPORT_EMAIL}</a></p>` : ""}
</div>
</td></tr></table>
</td></tr></table>
</body>
</html>`;

  const text = [
    message.eyebrow,
    message.heading,
    ...message.blocks.map(blockText),
    message.action
      ? `${message.action.label}\n${message.action.url}`
      : undefined,
    message.reason,
    support ? `Questions? ${SUPPORT_EMAIL}` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  return {
    templateId: message.templateId,
    templateVersion: message.templateVersion,
    subject: message.subject,
    html,
    text,
  };
}
