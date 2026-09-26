import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
test('evidence is private, batch-scoped, read-only, and rejects malformed coordinates',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./route.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'db',setup(b){
 b.onResolve({filter:/^next\/server$|^@\/lib\/supabase\/server$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='next/server'?`export const NextResponse={json:(b,i={})=>new Response(JSON.stringify(b),{...i,headers:i.headers})};`:`export async function createClient(){return globalThis.evidenceDb;}`}));
 }}]});
 const {GET}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const id='00000000-0000-4000-8000-000000000001', batch='broader-pilot-20260925-v1';
 let admin=true,loggedIn=true,selectedBatch=batch,reads=0;
 let payload={width:1920,height:1080,rawOffset:0,track:[[12.1,.2,.3]],bounces:[{t:12.1,x:.2,y:.3}],tableCorners:[[.1,.1],[.4,.1],[.5,.4],[.1,.4]],lineage:'Frozen run'};
 globalThis.evidenceDb={auth:{getUser:async()=>({data:{user:loggedIn?{id:'owner'}:null}})},rpc:async()=>({data:admin}),from(table){
 const filters={};return {select(){return this;},eq(k,v){filters[k]=v;return this;},async maybeSingle(){reads++;if(table==='point_ending_research'){assert.equal(filters.id,id);assert.equal(filters.batch,batch);return {data:selectedBatch===batch?{id}:null};}assert.equal(table,'point_ending_evidence');assert.equal(filters.point_id,id);return {data:payload?{payload}:null};}};
 }};
 const get=()=>GET(new Request('https://local.test/evidence?id='+id));
 try{
 let response=await get();assert.equal(response.status,200);assert.deepEqual((await response.json()).evidence,payload);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 admin=false;let before=reads;assert.equal((await get()).status,403);assert.equal(reads,before);admin=true;loggedIn=false;assert.equal((await get()).status,403);assert.equal(reads,before);loggedIn=true;
 selectedBatch='other';before=reads;assert.equal((await get()).status,404);assert.equal(reads,before+1);selectedBatch=batch;
 assert.equal((await GET(new Request('https://local.test/evidence?id=bad'))).status,400);
 payload={...payload,track:[[12.1,2,.3]]};assert.equal((await get()).status,500);
 payload=null;assert.equal((await get()).status,404);
 }finally{delete globalThis.evidenceDb;}
});
