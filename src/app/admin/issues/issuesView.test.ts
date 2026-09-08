import assert from "node:assert/strict";
import test from "node:test";
import { issueBucket, issueRows, refundPresentation, withMatchIdentity, decisionActions, versionFacts, restoreVersion, type IssueListRow } from "./issuesView.ts";

const row: IssueListRow = { id:"issue", match_id:"match",source_job_id:"job",reporter_id:"owner",owner_id:"owner",reporter_role:"owner",reporter_email:"owner@example.com",owner_email:"owner@example.com",kind:"refund",status:"pending",message:"Missed rally",refundable_minutes:11,created_at:"2026-09-07T12:00:00Z",updated_at:"2026-09-07T12:00:00Z" };

test("execution failures return to Pending; candidate review stays in Reprocessing", () => {
  for (const status of ["pending","execution_failed"]) assert.equal(issueBucket(status),"pending");
  for (const status of ["reprocess_queued","reprocessing","candidate_ready"]) assert.equal(issueBucket(status),"reprocessing");
  for (const status of ["resolved_refunded","resolved_reprocessed","declined","cancelled"]) assert.equal(issueBucket(status),"resolved");
  assert.equal(issueBucket("recorded"),null);
});

test("decision order follows the requested remedy and saved availability", () => {
  const labels = (kind: "refund" | "reprocess", status: IssueListRow["status"], available=true, minutes=11) => decisionActions({...row,kind,status,refundable_minutes:minutes},available,true).map(a=>[a.label,a.primary,a.enabled]);
  assert.deepEqual(labels("reprocess","pending"),[["Start reprocessing",true,true],["Return 11 minutes",false,true],["Close request",false,true]]);
  assert.deepEqual(labels("refund","pending"),[["Return 11 minutes",true,true],["Start reprocessing",false,true],["Close request",false,true]]);
  assert.equal(labels("reprocess","pending",false)[0][2],false);
  assert.deepEqual(labels("reprocess","candidate_ready"),[["Publish new version",true,true],["Keep current version",false,true],["Return 11 minutes",false,true]]);
  assert.deepEqual(labels("refund","candidate_ready",true,0),[["Publish new version",true,true],["Keep current version",false,true]]);
  for (const status of ["reprocess_queued","reprocessing","cancelled","declined","resolved_refunded"] as const) assert.deepEqual(labels("reprocess",status),[]);
  assert.deepEqual(labels("reprocess","resolved_reprocessed"),[["Restore previous version",false,true]]);
  assert.equal(decisionActions({...row,status:"candidate_ready"},true,false)[0].enabled,false);
  assert.equal(decisionActions({...row,status:"execution_failed"},true,false).some(a=>a.id==="close" && a.requiresPlayerNote),true);
  assert.equal(decisionActions({...row,status:"candidate_ready"},true,true).find(a=>a.id==="keep")?.requiresPlayerNote,true);
});
test("version facts preserve unknowns and restoration names only the retained source", () => {
  const current={id:"old",status:"superseded" as const,settings:{strictness:"normal",placement:true},release_id:"release-a",created_at:"2026-09-05",totals:{points:83,retained_duration_s:521}};
  const next={...current,id:"new",status:"active" as const,settings:{strictness:"tight",placement:false},release_id:"release-b",totals:{points:91,retained_duration_s:544}};
  assert.deepEqual(versionFacts(current),{points:"83",retained:"8:41",release:"release-a",strictness:"normal",placement:"Requested"});
  assert.deepEqual(versionFacts(next),{points:"91",retained:"9:04",release:"release-b",strictness:"tight",placement:"Not requested"});
  assert.equal(versionFacts({...current,totals:undefined,release_id:null}).retained,"Not recorded");
  assert.equal(restoreVersion({source_version_id:"old",replacement_version_id:"new",status:"resolved_reprocessed"},[current,next])?.id,"old");
  assert.equal(restoreVersion({source_version_id:"old",replacement_version_id:"new",status:"resolved_reprocessed"},[{...current,status:"active"},{...next,status:"superseded"}]),null);
});
test("Pending is oldest first, outcome filtering is exact and positive feedback adds no work", () => {
  const rows = [row,{...row,id:"older",kind:"reprocess" as const,created_at:"2026-09-06T12:00:00Z"},{...row,id:"failed",status:"execution_failed" as const,created_at:"2026-09-05T12:00:00Z"},{...row,id:"positive",kind:"positive" as const,status:"recorded" as const}];
  assert.deepEqual(issueRows(rows,"pending","all").map(r=>r.id),["failed","older","issue"]);
  assert.deepEqual(issueRows(rows,"pending","refund").map(r=>r.id),["failed","issue"]);
  assert.deepEqual(rows.map(r=>r.id),["issue","older","failed","positive"]);
});
test("refund button uses the exact saved amount and never enables unsupported or stale states", () => {
  assert.deepEqual(refundPresentation(row),{label:"Return 11 minutes",enabled:true,message:null});
  assert.equal(refundPresentation({...row,refundable_minutes:1}).label,"Return 1 minute");
  assert.equal(refundPresentation({...row,refundable_minutes:0}).enabled,false);
  assert.equal(refundPresentation({...row,refundable_minutes:0}).message,"No processing minutes are available to return.");
  assert.equal(refundPresentation({...row,status:"resolved_refunded"}).message,"11 processing minutes returned.");
  for (const status of ["cancelled","declined","reprocessing","resolved_reprocessed"] as const) assert.equal(refundPresentation({...row,status}).enabled,false);
  assert.equal(refundPresentation({...row,kind:"problem"}).enabled,false);
});

test("queue enriches match identity once per match and preserves rows when identity is unavailable", async () => {
  const seen: string[] = [];
  const enriched = await withMatchIdentity([row, { ...row, id: "second" }, { ...row, id: "third", match_id: "other" }], async id => {
    seen.push(id);
    return id === "issue" ? { opponentName: "Ada", playedAt: "2026-09-05" } : null;
  });
  assert.deepEqual(seen, ["issue", "third"]);
  assert.equal(enriched[0].match_title, "Ada");
  assert.equal(enriched[1].match_title, "Ada");
  assert.equal(enriched[2].match_title, undefined);
  assert.equal(row.match_title, undefined);
});
