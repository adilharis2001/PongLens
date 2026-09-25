import assert from 'node:assert/strict';
import test from 'node:test';
import {MATCH_COMPARISON_FIXTURE} from './matchComparisonFixture.ts';
import {emptyComparisonReview,mergeComparisonReview} from './matchComparison.ts';
import {comparisonDraftKey,readComparisonDraft,writeComparisonDraft,clearComparisonDraft} from './matchComparisonDrafts.ts';
function tabStorage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
const row=MATCH_COMPARISON_FIXTURE;
test('a new component restores every row draft after SPA unmount or reload',()=>{
 const storage=tabStorage(),second={...row,id:'00000000-0000-4000-8000-000000000009'};
 const firstReview={...emptyComparisonReview(),note:'Keep this across Back'},secondReview={...emptyComparisonReview(),start:'both' as const};
 writeComparisonDraft(storage,row,firstReview,row.revision);writeComparisonDraft(storage,second,secondReview,second.revision);
 assert.deepEqual(readComparisonDraft(storage,{...row}),{state:'draft',revision:0,review:firstReview});
 assert.deepEqual(readComparisonDraft(storage,{...second}),{state:'draft',revision:0,review:secondReview});
 assert.notEqual(comparisonDraftKey(row.id),comparisonDraftKey(second.id));
});
test('a newer saved revision restores the draft as conflict without overwriting either answer',()=>{
 const storage=tabStorage(),draft={...emptyComparisonReview(),note:'Local answer'};writeComparisonDraft(storage,row,draft,0);
 const saved={...emptyComparisonReview(),note:'Other window answer'},newer={...row,revision:1,label:mergeComparisonReview(row.label,saved)};
 assert.deepEqual(readComparisonDraft(storage,newer),{state:'conflict',revision:0,review:draft});
 writeComparisonDraft(storage,newer,{...draft,note:'Still my draft'},0);
 assert.equal(readComparisonDraft(storage,newer).state,'conflict');assert.equal(newer.label.comparisonReview.note,'Other window answer');
});
test('only matching saved acknowledgements clear drafts; a late response cannot remove a new edit',()=>{
 const storage=tabStorage(),draft={...emptyComparisonReview(),note:'Sent answer'};writeComparisonDraft(storage,row,draft,0);
 writeComparisonDraft(storage,row,{...draft,note:'Newer unsaved edit'},0);
 clearComparisonDraft(storage,row.id,{revision:0,review:draft});assert.equal(readComparisonDraft(storage,row).state,'draft');
 clearComparisonDraft(storage,row.id);assert.equal(readComparisonDraft(storage,row).state,'none');
 writeComparisonDraft(storage,row,draft,0);clearComparisonDraft(storage,row.id,{revision:0,review:draft});assert.equal(readComparisonDraft(storage,row).state,'none');
});
test('invalid, other-batch and wrong-row stored drafts are never restored',()=>{
 const storage=tabStorage();writeComparisonDraft(storage,row,emptyComparisonReview(),0);
 const key=comparisonDraftKey(row.id),valid=JSON.parse(storage.getItem(key)!);
 for(const patch of [{batch:'other'},{rowId:'wrong'},{revision:-1},{review:{...emptyComparisonReview(),winner:'fake'}}]){storage.setItem(key,JSON.stringify({...valid,...patch}));assert.equal(readComparisonDraft(storage,row).state,'none');}
 storage.setItem(key,'{broken');assert.equal(readComparisonDraft(storage,row).state,'none');
});
test('storage failure is explicit instead of claiming the draft was retained',()=>{
 assert.throws(()=>writeComparisonDraft({getItem:()=>null,setItem:()=>{throw Error('blocked');},removeItem:()=>{}},row,emptyComparisonReview(),0),/blocked/);
});
