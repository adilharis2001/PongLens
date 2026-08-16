#!/usr/bin/env node
/**
 * The run digest: one mail after every outreach run, so the list can grow
 * on a Monday morning without anyone opening a page to find out.
 *
 * It reports two things, and they answer different questions. Who turned up
 * is the interesting half, but only the ones in a market Stripe can pay are
 * worth reading, so those sort first and the rest are a count. Where the
 * list stands is the half that says whether there is anything to do today.
 *
 *   node scripts/marketing/notify.mjs --since <iso> --status succeeded
 *
 * Credentials come from the login Keychain under account `openclaw`:
 * `ponglens-service-role` and `ponglens-resend-key`. Not `resend-api-key`,
 * which is WDIMT's: it belongs to a Resend account where ponglens.com is
 * not a verified domain, so it answers 403 on the send rather than on the
 * key. The recipient is
 * `app_config.digest_recipient`, the same key the worker's feedback digest
 * uses, so the address lives in one place and not in a public repo.
 */

import { execFileSync } from "node:child_process";

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const APP_URL = "https://www.ponglens.com";
const FROM = "PongLens <noreply@ponglens.com>";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

function keychain(service) {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-a", "openclaw", "-s", service, "-w"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    throw new Error(`missing Keychain secret: openclaw/${service}`);
  }
}

/** Where a coach can be paid, which is the only kind worth writing to. */
const reachable = (c) =>
  c.payments_supported && (c.region === "us" || c.region === "europe");

/**
 * The state of the whole list, not of this run. `waiting` is the number
 * that matters day to day: coaches who can be paid and have not been
 * written to yet. Everything else is context for that one figure.
 */
export function digestStats(coaches) {
  const live = ["found", "qualified", "ready", "warming"];
  return {
    total: coaches.length,
    reachable: coaches.filter(reachable).length,
    waiting: coaches.filter((c) => reachable(c) && live.includes(c.stage)).length,
    warming: coaches.filter((c) => c.stage === "warming").length,
    contacted: coaches.filter((c) => c.stage === "contacted").length,
    replied: coaches.filter((c) =>
      ["replied", "trialling", "signed_up"].includes(c.stage),
    ).length,
    unplaced: coaches.filter((c) => c.region === "unknown").length,
  };
}

/**
 * The subject line carries the whole message, because most mornings that is
 * all he will read. New coaches first, then how many of them he can act on,
 * because twelve finds in Egypt and India is a quieter morning than two in
 * Ohio however it sorts.
 */
export function digestSubject(found, status) {
  if (status !== "succeeded") return "PongLens coach search failed";
  if (!found.length) return "PongLens coach search: nothing new";
  const payable = found.filter(reachable).length;
  const n = `${found.length} new coach${found.length === 1 ? "" : "es"}`;
  return payable
    ? `PongLens coach search: ${n}, ${payable} you can pay`
    : `PongLens coach search: ${n}, none in a payable country`;
}

/** New arrivals, the ones worth reading first. */
export function sortFound(found) {
  return [...found].sort(
    (a, b) =>
      Number(reachable(b)) - Number(reachable(a)) ||
      (b.followers ?? 0) - (a.followers ?? 0),
  );
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const nf = (n) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}m`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n);

const ROW_LIMIT = 20;

function coachRow(c) {
  const ok = reachable(c);
  return `<tr>
<td style="padding:8px 0;border-top:1px solid #eef0f3;font-size:13px;color:#111827;">
<a href="https://www.instagram.com/${esc(c.handle)}" style="color:#0891b2;text-decoration:none;font-weight:600;">@${esc(c.handle)}</a>
${c.full_name ? `<div style="color:#6b7280;font-size:12px;">${esc(c.full_name)}</div>` : ""}
</td>
<td style="padding:8px 0;border-top:1px solid #eef0f3;font-size:13px;color:#4b5563;text-align:right;white-space:nowrap;">
${esc(c.country || "?")}${c.entity_type === "club" ? " · club" : ""}
</td>
<td style="padding:8px 0;border-top:1px solid #eef0f3;font-size:13px;color:#4b5563;text-align:right;white-space:nowrap;">${nf(c.followers ?? 0)}</td>
<td style="padding:8px 0 8px 12px;border-top:1px solid #eef0f3;font-size:12px;text-align:right;white-space:nowrap;color:${ok ? "#047857" : "#9ca3af"};">${ok ? "can pay" : "no Stripe"}</td>
</tr>`;
}

export function digestHtml({ found, stats, status, terms, runs, error }) {
  const sorted = sortFound(found);
  const shown = sorted.slice(0, ROW_LIMIT);
  const rest = sorted.length - shown.length;
  const cost = runs.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0);

  const head =
    status === "succeeded"
      ? `${found.length === 0 ? "No new coaches" : `${found.length} new coach${found.length === 1 ? "" : "es"}`} from the "${esc(terms)}" search.`
      : `The run failed.${error ? ` ${esc(error)}` : ""}`;

  const table = shown.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
${shown.map(coachRow).join("\n")}
</table>
${rest > 0 ? `<div style="font-size:13px;color:#6b7280;margin:-16px 0 24px;">and ${rest} more on the page.</div>` : ""}`
    : "";

  const stat = (label, value, strong = false) =>
    `<tr>
<td style="padding:6px 0;font-size:13px;color:#4b5563;">${label}</td>
<td style="padding:6px 0;font-size:13px;text-align:right;color:${strong ? "#111827" : "#4b5563"};font-weight:${strong ? 700 : 400};">${value}</td>
</tr>`;

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(head)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;padding:32px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
<tr><td align="center" style="padding-bottom:24px;">
<img src="${APP_URL}/img/email-logo.png" width="120" alt="PongLens" style="display:block;">
</td></tr>
<tr><td style="font-size:18px;font-weight:600;color:#111827;padding-bottom:8px;">${head}</td></tr>
<tr><td>${table}</td></tr>
<tr><td style="font-size:14px;font-weight:600;color:#111827;padding-bottom:4px;">The list</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
${stat("Waiting for a first message", stats.waiting, true)}
${stat("Can be paid, US and Europe", stats.reachable)}
${stat("Warming", stats.warming)}
${stat("Contacted", stats.contacted)}
${stat("Replied or further", stats.replied)}
${stat("Country still unknown", stats.unplaced)}
${stat("On the list altogether", stats.total)}
</table>
</td></tr>
<tr><td align="center">
<a href="${APP_URL}/marketing/coach-outreach" style="display:inline-block;background:#0891b2;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:999px;">Open the outreach list</a>
</td></tr>
<tr><td style="padding-top:24px;font-size:12px;color:#9ca3af;text-align:center;">
Apify and the model cost $${cost.toFixed(2)} this run. Nothing was sent to anyone.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

async function rest(path) {
  const key = keychain("ponglens-service-role");
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const since = flag("since");
  const status = flag("status", "succeeded");
  if (!since) throw new Error("--since <iso> is required");
  if (args.includes("--dry-run")) {
    console.log("notify: dry run, no mail sent");
    return;
  }

  const [found, all, runs, config] = await Promise.all([
    rest(
      `outreach_coaches?created_at=gte.${encodeURIComponent(since)}` +
        "&select=handle,full_name,country,region,payments_supported,entity_type,followers",
    ),
    rest("outreach_coaches?select=stage,region,payments_supported"),
    rest(
      `outreach_runs?started_at=gte.${encodeURIComponent(since)}` +
        "&select=agent,status,found,added,cost_usd,error",
    ),
    rest("app_config?key=eq.digest_recipient&select=value"),
  ]);

  const to = (config?.[0]?.value ?? "").trim();
  if (!to) {
    console.log("notify: app_config.digest_recipient is empty, nothing to mail");
    return;
  }

  const failed = runs.find((r) => r.status === "failed");
  const html = digestHtml({
    found,
    stats: digestStats(all),
    status: failed ? "failed" : status,
    terms: flag("terms", "en"),
    runs,
    error: failed?.error ?? null,
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keychain("ponglens-resend-key")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to,
      // Ops mail to the operator, so it deliberately does not consult
      // email_suppressions the way customer mail does. A bounce here should
      // stop the digests, not silently keep the searches running unseen.
      subject: digestSubject(found, failed ? "failed" : status),
      html,
    }),
  });
  if (!res.ok) {
    throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  console.log(`notify: digest sent to ${to} (${found.length} new)`);
}

// Importing this file for its pure helpers must not fire a mail, so the
// send only runs when it is the thing that was executed.
if (process.argv[1] && process.argv[1].endsWith("notify.mjs")) {
  await main();
}
