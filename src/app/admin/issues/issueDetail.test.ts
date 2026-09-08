import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as view from "./issuesView.ts";
import * as uploadView from "../uploads/uploadView.ts";

const require = createRequire(import.meta.url);
/** Render the real TSX under Node's strip-types test runner. Only browser and
 * Next infrastructure are replaced; the detail and shared facts are real. */
function loadComponent(file: string, imports: Record<string, unknown>) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { fileName: fileURLToPath(new URL(file, import.meta.url)), compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const compiledModule = { exports: {} as Record<string, ComponentType<Record<string, unknown>>> };
  new Function("require", "module", "exports", compiled.outputText)((id: string) => imports[id] ?? require(id), compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const summary = loadComponent("../uploads/UploadProcessingSummary.tsx", { "./uploadView": uploadView });
const comparison = loadComponent("./CandidateComparison.tsx", {
  "@/app/match/[id]/ClipPlayer": { ClipPlayer: () => createElement("video") },
  "../uploads/uploadView": uploadView, "./issuesView": view,
});
const { MatchIssueDetail } = loadComponent("./MatchIssueDetail.tsx", {
  "next/link": { __esModule: true, default: "a" },
  "@/lib/supabase/client": { createClient: () => { throw new Error("render must not fetch"); } },
  "@/app/match/[id]/ClipPlayer": { ClipPlayer: () => createElement("video") },
  "../AdminHeader": { AdminHeader: ({ title }: { title: string }) => createElement("h1", null, title) },
  "../uploads/UploadProcessingSummary": summary,
  "../uploads/uploadView": uploadView,
  "./issuesView": view,
  "./CandidateComparison": comparison,
});

test("candidate review renders the exact facts, effects and action order inside the existing decision", () => {
  const detail={...initialDetail,sourceAvailable:true,issue:{...initialDetail.issue,kind:"reprocess",status:"candidate_ready",source_version_id:"old",replacement_version_id:"new"},versions:[
    {id:"old",status:"active",created_at:"2026-09-05",settings:{strictness:"normal",placement:true},release_id:"release-old",cut_path:"r2://cut/old",totals:{points:83,retained_duration_s:521},effects:{scores:61,notes:4}},
    {id:"new",status:"ready",created_at:"2026-09-07",settings:{strictness:"tight",placement:false},release_id:"release-new",cut_path:"r2://cut/new",totals:{points:91,retained_duration_s:544}},
  ]};
  const html=renderToStaticMarkup(createElement(MatchIssueDetail,{initialDetail:detail,upload:null,identity:null}));
  for(const text of ["83 points","8:41 retained","91 points","9:04 retained","release-old","release-new","61 scores · 4 notes","Player-visible explanation","Internal notes (optional)"]) assert.ok(html.includes(text),text);
  assert.ok(html.indexOf("Publish new version")<html.indexOf("Keep current version"));
  assert.ok(html.indexOf("Keep current version")<html.indexOf("Return 11 minutes"));
  assert.doesNotMatch(html,/Start reprocessing|Close request|Restore previous version/);
  assert.match(html,/disabled=""[^>]*>Keep current version/);
});
const initialDetail = {
  issue: { id: "issue", match_id: "match", source_job_id: "source-job-evidence", owner_id: "owner", reporter_id: "owner", reporter_role: "owner", kind: "refund", status: "pending", refundable_minutes: 11, message: "Missing rallies", created_at: "2026-09-07T12:00:00Z", player_note: "", internal_note: "" },
  match: { opponentName: "Opponent", playedAt: "2026-09-05" }, events: [],
};

test("upload diagnostics failure preserves source job and recorded refundable evidence", () => {
  const html = renderToStaticMarkup(createElement(MatchIssueDetail, { initialDetail, upload: null, identity: null }));
  assert.match(html, /Could not load the upload summary/);
  assert.match(html, /Source job: source-job-evidence/);
  assert.match(html, /11 refundable processing minutes recorded for this request/);
  assert.match(html, /href="\/admin\/uploads\/match"/);
});

test("issue review does not add a current-cut launch control", () => {
  const upload = { match: { raw_available: true, has_cut: true }, owner: null, job: null, points: [], totals: { visible: 5, deleted: 0, scored: 0, starred: 0, edited: 0, src_duration_s: 600, cut_duration_s: 100 } };
  const html = renderToStaticMarkup(createElement(MatchIssueDetail, { initialDetail, upload, identity: null }));
  assert.doesNotMatch(html, /Play them through/);
  assert.match(html, /Open upload diagnosis/);
});
