/** Exercise the actual route against an in-memory DB; no network or real data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

test('admin-only, batch-scoped revision saves preserve labels and immutable source',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./route.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'mock-admin-db',setup(b){
  b.onResolve({filter:/^next\/server$|^@\/lib\/supabase\/server$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='next/server'?`export const NextResponse={json:(body,init={})=>new Response(JSON.stringify(body),{...init,headers:{'Content-Type':'application/json',...init.headers}})};`:`export async function createClient(){return globalThis.testComparisonDb;}`}));
 }}]});
 const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const batch='broader-pilot-20260925-v1',id='00000000-0000-4000-8000-000000000001';
 const source={schema:'match-comparison-v1',runId:batch,matchName:'Fixture',number:1,game:1,fps:30,duration:100,preview:{start:8,end:22},original:{start:10,end:20},proposed:{start:9,end:21},players:{near:'A',far:'B'},predictedWinner:{side:'near',name:'A',decisionScore:.8,threshold:.7,branch:'hybrid'},savedWinner:{side:'far',name:'B',basis:'Fixture'},flags:[],referencePointIds:[],machinePointIds:['1'],lineage:'Fixture'};
 let admin=true,reads=0,writes=0;
 let row={id,batch,match_id:id,sequence:1,source,label:{reason:'net',custom:'',note:'old root note',future:{value:7}},revision:0};
 function query(table){
  assert.equal(table,'point_ending_research');const filters=[];let patch=null;
  return {
   select(){return this;},eq(k,v){filters.push([k,v]);return this;},update(p){patch=p;return this;},
   async maybeSingle(){
    reads++;if(filters.some(([k,v])=>row[k]!==v))return {data:null};
    if(patch){assert.deepEqual(Object.keys(patch).sort(),['label','revision']);writes++;row={...row,...patch};}
    return {data:structuredClone(row)};
   }
  };
 }
 globalThis.testComparisonDb={auth:{getUser:async()=>({data:{user:{id:'reviewer'}}})},rpc:async()=>({data:admin}),from:query};
 try{
  const review={version:1,runId:batch,start:'proposed',end:'both',winner:null,note:'new comparison note'};
  const post=b=>api.POST(new Request('http://local/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}));
  let response=await post({id,revision:0,review});assert.equal(response.status,200);assert.equal(writes,1);assert.equal(row.label.note,'old root note');assert.deepEqual(row.label.future,{value:7});assert.deepEqual(row.source,source);
  response=await post({id,revision:0,review});assert.equal(response.status,200);assert.equal(writes,1);
  response=await post({id,revision:0,review:{...review,note:'stale'}});assert.equal(response.status,409);assert.equal(writes,1);
  response=await post({id,revision:1,review,source:{}});assert.equal(response.status,400);assert.equal(writes,1);
  admin=false;const before=reads;response=await post({id,revision:1,review});assert.equal(response.status,403);assert.equal(reads,before);admin=true;
  row.batch='out-ball-479-v1';response=await post({id,revision:1,review});assert.equal(response.status,404);assert.equal(writes,1);row.batch=batch;
  row.source={...source,proposed:null};response=await post({id,revision:1,review});assert.equal(response.status,400);assert.equal(writes,1);
 }finally{delete globalThis.testComparisonDb;}
});
