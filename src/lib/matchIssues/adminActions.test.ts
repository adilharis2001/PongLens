import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminRefund, type AdminRefundDependencies } from "./adminActions.ts";

const ID="77777777-7777-4777-8777-777777777707";
const detail={issue:{id:ID,kind:"refund",status:"resolved_refunded",refundable_minutes:11}};
const input={playerNote:"  Missing rallies.  ",internalNote:"  Checked original.  "};
function request(body:unknown=input) { return new Request("https://ponglens.com/api/admin/match-issues/"+ID+"/refund",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); }
function deps(overrides:Partial<AdminRefundDependencies>={}):AdminRefundDependencies {
  return {authenticate:async()=>({userId:"admin",isAdmin:true}),refund:async()=>({data:detail,error:null}),loadDetail:async()=>({data:detail,error:null}),sendEmail:async()=>{},reportError:()=>{},...overrides};
}
test("signed-out and non-admin callers cannot reach the refund RPC", async()=>{
  for(const [actor,status] of [[null,401],[{userId:"owner",isAdmin:false},403]] as const){
    const response=await handleAdminRefund(request(),ID,deps({authenticate:async()=>actor,refund:async()=>{throw new Error("must not run");}}));
    assert.equal(response.status,status);
  }
});
test("invalid ids, absent player explanation, oversized or malformed notes cannot reach refund",async()=>{
  for(const body of [{playerNote:" "},{playerNote:"x".repeat(1001)},{playerNote:"ok",internalNote:"x".repeat(4001)},{playerNote:7},{playerNote:"ok",minutes:500}]){
    assert.equal((await handleAdminRefund(request(body),ID,deps({refund:async()=>{throw new Error("must not run");}}))).status,400);
  }
  assert.equal((await handleAdminRefund(request(),"bad",deps())).status,400);
});
test("successful refund passes only trimmed notes and returns the database's canonical result",async()=>{
  let values:unknown;
  let mailed="";
  const response=await handleAdminRefund(request(),ID,deps({refund:async(...args)=>{values=args;return {data:detail,error:null};},sendEmail:async id=>{mailed=id;}}));
  assert.equal(response.status,200);
  assert.deepEqual(values,[ID,"Missing rallies.","Checked original."]);
  assert.deepEqual(await response.json(),{detail});
  assert.equal(mailed,ID);
});
test("repeated action returns saved result, with no client-calculated credit",async()=>{
  const saved=deps();
  assert.deepEqual(await (await handleAdminRefund(request(),ID,saved)).json(),{detail});
  assert.deepEqual(await (await handleAdminRefund(request(),ID,saved)).json(),{detail});
});
test("conflicting decisions return the latest saved detail rather than replaying the action",async()=>{
  const closed={issue:{...detail.issue,status:"declined"}};
  const response=await handleAdminRefund(request(),ID,deps({refund:async()=>({data:null,error:{code:"P0001"}}),loadDetail:async()=>({data:closed,error:null}),sendEmail:async()=>{throw new Error("must not send");}}));
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{code:"conflict",detail:closed});
});
test("database authorization is rechecked and delivery failure never undoes a saved refund",async()=>{
  assert.equal((await handleAdminRefund(request(),ID,deps({refund:async()=>({data:null,error:{code:"42501"}})}))).status,403);
  let reported=false;
  const response=await handleAdminRefund(request(),ID,deps({sendEmail:async()=>{throw new Error("mail unavailable");},reportError:()=>{reported=true;}}));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{detail});
  assert.equal(reported,true);
});
