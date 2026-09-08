import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";

const versionId="11111111-1111-4111-8111-111111111111";
function route({admin=true,match="match",rpcError=false}={}) {
  const calls:string[]=[];
  const source=readFileSync(new URL("../../app/api/admin/media-url/route.ts",import.meta.url),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}});
  const exports:{POST?:(req:Request)=>Promise<Response>}={};
  const deps:Record<string,unknown>={
    "next/server":{NextResponse:{json:Response.json}},
    "@/lib/config":{isAdminEmail:(email:string)=>email==="admin@example.com"},
    "@/lib/supabase/server":{createClient:async()=>({auth:{getUser:async()=>({data:{user:{email:admin?"admin@example.com":"owner@example.com"}}})},rpc:async(name:string,args:unknown)=>{calls.push(name);assert.deepEqual(args,{p_version_id:versionId});return {data:{version:{match_id:match,cut_path:"r2://private-cut/candidate.mp4"}},error:rpcError?{code:"42501"}:null};}})},
    "@/lib/r2":{presignGet:async(bucket:string,key:string)=>{calls.push(`${bucket}/${key}`);return "https://signed.example/candidate";}},
  };
  new Function("require","exports",compiled.outputText)((name:string)=>{if(!(name in deps))throw new Error(name);return deps[name];},exports);
  return {call:(body:unknown)=>exports.POST!(new Request("https://ponglens.com/api/admin/media-url",{method:"POST",body:JSON.stringify(body)})),calls};
}
test("candidate signing uses only the admin RPC path after authentication and match binding",async()=>{
  const denied=route({admin:false}); assert.equal((await denied.call({matchId:"match",versionId})).status,403); assert.deepEqual(denied.calls,[]);
  for(const options of [{match:"other"},{rpcError:true}]) {const boundary=route(options);assert.equal((await boundary.call({matchId:"match",versionId})).status,403);assert.deepEqual(boundary.calls,["admin_match_version_detail"]);}
  const valid=route(); const response=await valid.call({matchId:"match",versionId,path:"r2://evil/object"});assert.equal(response.status,200);assert.deepEqual(await response.json(),{url:"https://signed.example/candidate"});assert.deepEqual(valid.calls,["admin_match_version_detail","private-cut/candidate.mp4"]);
});
test("candidate signing rejects malformed identity or mixed original/point selection before the RPC",async()=>{
  for(const body of [{matchId:"match",versionId:"-".repeat(36)},{matchId:"match",versionId,raw:true},{matchId:"match",versionId,pointId:"point"}]) {const boundary=route();assert.equal((await boundary.call(body)).status,400);assert.deepEqual(boundary.calls,[]);}
});
