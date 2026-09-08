import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminVersionAction, type AdminVersionDependencies, type AdminVersionAction } from "./adminReprocessActions.ts";

const id = "11111111-1111-4111-8111-111111111111";
const saved = { issue: { id, status: "candidate_ready" }, events: [] };
const request = (body: unknown) => new Request("https://ponglens.com/action", { method: "POST", body: JSON.stringify(body) });
function dependencies(overrides: Partial<AdminVersionDependencies> = {}) {
  const calls: string[] = [];
  const deps: AdminVersionDependencies = {
    async authenticate() { return { userId: "admin", isAdmin: true }; },
    async rpc(name, args) { calls.push(name); assert.equal(args.p_issue_id, id); return { data: saved, error: null }; },
    async loadDetail() { calls.push("load"); return { data: saved, error: null }; },
    async sendEmail() { calls.push("email"); },
    reportError() {}, ...overrides,
  };
  return { deps, calls };
}
const actions: AdminVersionAction[] = ["reprocess", "publish", "keep", "close", "restore"];
for (const action of actions) {
  const body = action === "reprocess" ? { options: { strictness: "tight", placement: true }, internalNote: " Check " } : { playerNote: " Reviewed. ", ...(action === "restore" ? {} : { internalNote: " Check " }) };
  test(`${action} authenticates before touching the request or RPC`, async () => {
    for (const [actor, status] of [[null,401],[{userId:"owner",isAdmin:false},403]] as const) {
      const { deps, calls } = dependencies({ async authenticate() { return actor; } });
      assert.equal((await handleAdminVersionAction(request(body), id, action, deps)).status, status);
      assert.deepEqual(calls, []);
    }
  });
  test(`${action} saves once before best-effort email and returns the canonical decision`, async () => {
    const { deps, calls } = dependencies({ async sendEmail() { calls.push("email"); throw new Error("provider down"); } });
    const result = await handleAdminVersionAction(request(body), id, action, deps);
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { detail: saved });
    assert.equal(calls.length, action === "reprocess" ? 1 : 2);
    assert.notEqual(calls[0], "email");
  });
  test(`${action} returns saved state after a stale race without emailing`, async () => {
    const { deps, calls } = dependencies({ async rpc() { calls.push("mutation"); return { data: null, error: { code: "P0001" } }; } });
    const result = await handleAdminVersionAction(request(body), id, action, deps);
    assert.equal(result.status, 409); assert.deepEqual(await result.json(), { code: "conflict", detail: saved });
    assert.deepEqual(calls,["mutation","load"]);
  });
  test(`${action} refuses invalid identity, notes and untrusted fields before saving`, async () => {
    for (const invalid of [{...body,ownerId:"evil"},{...body,internalNote:"x".repeat(4001)}, ...(action === "reprocess" ? [{options:{strictness:"wild"}},{options:{placement:"true"}},{options:{trim_start_s:2}},{options:{release_id:"evil"}}] : [{playerNote:" "},{playerNote:"x".repeat(1001)}])]) {
      const { deps, calls } = dependencies();
      assert.equal((await handleAdminVersionAction(request(invalid), id, action, deps)).status,400);
      assert.deepEqual(calls,[]);
    }
  });
  test(`${action} maps database failures without claiming a saved decision`, async () => {
    for (const [code, status] of [["42501",403],["P0002",404],["23514",400],["XX000",503]] as const) {
      const { deps, calls } = dependencies({ async rpc() { return {data:null,error:{code}}; } });
      assert.equal((await handleAdminVersionAction(request(body), id, action, deps)).status,status); assert.deepEqual(calls,[]);
    }
  });
}
test("reprocess forwards only supported settings; restore accepts no client match or version", async () => {
  const {deps} = dependencies({ async rpc(name,args) {
    assert.equal(name,"admin_start_match_reprocess"); assert.deepEqual(args,{p_issue_id:id,p_options:{strictness:"loose",placement:false},p_internal_note:"Check"}); return {data:saved,error:null};
  } });
  await handleAdminVersionAction(request({options:{strictness:"loose",placement:false},internalNote:" Check "}),id,"reprocess",deps);
  const restore = dependencies({ async rpc(name,args) { assert.equal(name,"admin_restore_match_issue_version"); assert.deepEqual(args,{p_issue_id:id,p_player_note:"Restore."}); return {data:saved,error:null}; } });
  await handleAdminVersionAction(request({playerNote:"Restore."}),id,"restore",restore.deps);
});
test("strictness must be a scalar string, never a coercible array",async()=>{
  const {deps,calls}=dependencies();
  assert.equal((await handleAdminVersionAction(request({options:{strictness:["normal"]}}),id,"reprocess",deps)).status,400);
  assert.deepEqual(calls,[]);
});
