import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { digestMessage } from "../marketing/notify.mjs";
import { typescriptEmailFixtures } from "../../src/lib/email/fixtures.ts";
import { renderEmail } from "../../src/lib/email/render.ts";

export type EmailPreview = {
  id: string;
  label: string;
  source: "typescript" | "python" | "marketing";
  templateId: string;
  templateVersion: number;
  subject: string;
  html: string;
  text: string;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "../..");

function pythonPreviews(): EmailPreview[] {
  const output = execFileSync(
    process.env.PONGLENS_PREVIEW_PYTHON || "python3",
    [join(REPO_ROOT, "worker/email_templates.py"), "--fixtures-json"],
    { encoding: "utf8" },
  );
  const rows = JSON.parse(output) as Array<{
    id: string; label: string; template_id: string; template_version: number;
    subject: string; html: string; text: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    source: "python",
    templateId: row.template_id,
    templateVersion: row.template_version,
    subject: row.subject,
    html: row.html,
    text: row.text,
  }));
}

function outreachPreviews(): EmailPreview[] {
  const stats = {
    waiting: 18, reachable: 24, warming: 7, contacted: 12,
    replied: 4, unplaced: 3, total: 46,
  };
  const found = [
    { handle: "spinwithmaya", full_name: "Maya Chen", country: "US", region: "north_america", payments_supported: true, entity_type: "coach", followers: 12800 },
    { handle: "tabletennisnorth", full_name: "Table Tennis North", country: "CA", region: "north_america", payments_supported: false, entity_type: "club", followers: 4100 },
  ];
  const variants = [
    {
      id: "ops.coach-outreach.succeeded",
      label: "Coach outreach search succeeded",
      rendered: digestMessage({
        found, stats, status: "succeeded", terms: "table tennis coach",
        runs: [{ cost_usd: 1.24 }], error: null,
      }),
    },
    {
      id: "ops.coach-outreach.failed",
      label: "Coach outreach search failed",
      rendered: digestMessage({
        found: [], stats, status: "failed", terms: "table tennis coach",
        runs: [{ cost_usd: 0.18 }], error: "The source stopped responding before discovery finished.",
      }),
    },
  ];
  return variants.map(({ id, label, rendered }) => ({
    id, label, source: "marketing", ...rendered,
  }));
}

export function allEmailPreviews(): EmailPreview[] {
  const typescript = typescriptEmailFixtures().map((fixture) => ({
    id: fixture.id,
    label: fixture.label,
    source: "typescript" as const,
    ...renderEmail(fixture.message),
  }));
  return [...typescript, ...pythonPreviews(), ...outreachPreviews()]
    .sort((left, right) => left.id.localeCompare(right.id));
}

function escaped(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function forcedTheme(html: string, theme: "light" | "dark"): string {
  const condition = theme === "dark" ? "(min-width: 0px)" : "(max-width: 0px)";
  return html.replace("(prefers-color-scheme: dark)", condition);
}

export function writePreviewGallery(
  outputPath = join(REPO_ROOT, "build/email-preview/index.html"),
): string {
  const previews = allEmailPreviews().map((preview) => ({
    ...preview,
    lightHtml: forcedTheme(preview.html, "light"),
    darkHtml: forcedTheme(preview.html, "dark"),
  }));
  const safeJson = JSON.stringify(previews).replace(/</g, "\\u003c");
  const options = previews.map((preview, index) =>
    `<option value="${index}">${escaped(preview.id)} · ${escaped(preview.label)}</option>`,
  ).join("");
  const gallery = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PongLens email preview catalog</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#08090f;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{position:sticky;top:0;z-index:2;padding:20px;background:rgba(8,9,15,.96);border-bottom:1px solid #27272a}h1{margin:0 0 14px;font-size:22px}select{width:min(760px,100%);padding:12px 14px;border:1px solid #3f3f46;border-radius:10px;background:#18181b;color:#f4f4f5;font-size:15px}.meta{margin:12px 0 0;color:#a1a1aa;font-size:13px}.panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;padding:18px}.panel{min-width:0}.panel h2{margin:0 0 10px;font-size:15px}.frame{width:100%;height:720px;border:1px solid #3f3f46;border-radius:14px;background:white}.plain{margin:0 18px 24px;padding:18px;white-space:pre-wrap;overflow-wrap:anywhere;background:#101119;border:1px solid #27272a;border-radius:14px;color:#c4c4cc;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:760px){.panels{grid-template-columns:1fr;padding:12px}.frame{height:660px}header{padding:16px}.plain{margin:0 12px 18px}}
</style></head><body>
<header><h1>PongLens email preview catalog</h1><select id="picker">${options}</select><p class="meta" id="meta"></p></header>
<main><div class="panels"><section class="panel"><h2>Forced light</h2><iframe title="Light email preview" class="frame" id="light"></iframe></section><section class="panel"><h2>Forced dark</h2><iframe title="Dark email preview" class="frame" id="dark"></iframe></section></div><pre class="plain" id="plain"></pre></main>
<script>const previews=${safeJson};const picker=document.getElementById("picker");function show(){const p=previews[Number(picker.value)];document.getElementById("meta").textContent=p.subject+" · "+p.source+" · "+p.templateId+" v"+p.templateVersion;document.getElementById("light").srcdoc=p.lightHtml;document.getElementById("dark").srcdoc=p.darkHtml;document.getElementById("plain").textContent=p.text}picker.addEventListener("change",show);show();</script>
</body></html>`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, gallery);
  return outputPath;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const path = writePreviewGallery();
  console.log(`Email preview gallery: ${path}`);
}
