import assert from 'node:assert/strict';
import test from 'node:test';
import {COMPARISON_BATCH,emptyComparisonReview,validComparisonSource,validComparisonReview,mergeComparisonReview,comparisonReview,comparisonPlaybackWindow,comparisonMediaKey,parseComparisonRow,comparisonReviewAllowed} from './matchComparison.ts';
const id='00000000-0000-4000-8000-000000000001';
const source={schema:'match-comparison-v1',runId:COMPARISON_BATCH,matchName:'Fixture match',number:1,game:1,fps:30,duration:100,preview:{start:8,end:22},original:{start:10,end:20},proposed:{start:9,end:21},players:{near:'Player A',far:'Player B'},predictedWinner:{side:'near',name:'Player A',decisionScore:.8,threshold:.7,branch:'hybrid'},savedWinner:{side:'far',name:'Player B',basis:'Independent side audit'},flags:[],referencePointIds:[id],machinePointIds:['1'],lineage:'Local synthetic fixture'};
test('source accepts paired and explicit unmatched windows, rejects invalid clocks and scores',()=>{
 assert.equal(validComparisonSource(source),true);
 assert.equal(validComparisonSource({...source,original:null}),true);
 for(const patch of [{original:null,proposed:null},{preview:{start:10,end:20}},{fps:0},{duration:19},{proposed:{start:21,end:20}},{predictedWinner:{...source.predictedWinner,decisionScore:80}},{referencePointIds:['not-an-id']},{runId:'other'}])assert.equal(validComparisonSource({...source,...patch}),false);
});
test('all review fields are optional answers, but the complete payload is validated',()=>{
 assert.equal(validComparisonReview(emptyComparisonReview()),true);
 for(const patch of [{version:2},{runId:'other'},{start:'yes'},{winner:'near'},{note:'x'.repeat(4001)},{note:3}])assert.equal(validComparisonReview({...emptyComparisonReview(),...patch}),false);
 assert.equal(validComparisonReview({...emptyComparisonReview(),unexpected:'field'}),false);
});
test('save merges only review values, preserving root and future nested labels without input mutation',()=>{
 const previous={reason:'net',custom:'',note:'Earlier note',other:{answer:true},comparisonReview:{...emptyComparisonReview(),futureAnswer:'keep'}};
 const original=JSON.stringify(previous);const review={...emptyComparisonReview(),start:'proposed' as const,note:'Review note'};
 const next=mergeComparisonReview(previous,review);
 assert.deepEqual(next.other,{answer:true});assert.equal(next.note,'Earlier note');assert.equal(next.comparisonReview.futureAnswer,'keep');assert.equal(next.comparisonReview.start,'proposed');assert.equal(JSON.stringify(previous),original);
});
test('previous run answers are not shown as approval for this run',()=>{
 assert.deepEqual(comparisonReview({comparisonReview:{...emptyComparisonReview(),runId:'old',start:'proposed'}}),emptyComparisonReview());
});
test('playback preserves exact proposed start, current end and preview bounds',()=>{
 assert.ok(validComparisonSource(source));
 assert.deepEqual(comparisonPlaybackWindow(source,'current'),{start:10,end:20});
 assert.deepEqual(comparisonPlaybackWindow(source,'proposed'),{start:9,end:21});
 assert.deepEqual(source.original,{start:10,end:20});
 assert.equal(comparisonPlaybackWindow({...source,proposed:null},'proposed'),null);
});
test('only seeded raw paths and complete independent rows are accepted',()=>{
 assert.equal(comparisonMediaKey(`r2://ponglens-raw/${id}/${id}.mov`),`${id}/${id}.mov`);
 assert.equal(comparisonMediaKey('https://example.org/video.mp4'),null);
 assert.equal(comparisonMediaKey(`r2://ponglens-raw/${id}/../secret`),null);
 assert.ok(parseComparisonRow({id,match_id:id,sequence:1,revision:0,source,label:{reason:null,custom:'',note:''}}));
 assert.throws(()=>parseComparisonRow({id,match_id:id,sequence:1,revision:-1,source,label:{}}));
});

test('cannot approve missing windows or absent winner predictions',()=>{
 assert.ok(validComparisonSource(source));
 assert.equal(comparisonReviewAllowed({...emptyComparisonReview(),start:'current'},{...source,original:null}),false);
 assert.equal(comparisonReviewAllowed({...emptyComparisonReview(),end:'proposed'},{...source,proposed:null}),false);
 assert.equal(comparisonReviewAllowed({...emptyComparisonReview(),winner:'prediction'},{...source,predictedWinner:{side:null,name:null,decisionScore:null,threshold:null,branch:null}}),false);
 assert.equal(comparisonReviewAllowed({...emptyComparisonReview(),winner:'unsure'},source),true);
});

test('both timing windows may be approved only when both exist',()=>{
 assert.ok(validComparisonSource(source));
 const review={...emptyComparisonReview(),start:'both' as const,end:'both' as const};
 assert.equal(validComparisonReview(review),true);
 assert.equal(comparisonReviewAllowed(review,source),true);
 assert.equal(comparisonReviewAllowed(review,{...source,original:null}),false);
 assert.equal(comparisonReviewAllowed(review,{...source,proposed:null}),false);
});

test('decision score belongs to a selected winner and raw-score-only payloads are rejected',()=>{
 assert.equal(validComparisonSource({...source,predictedWinner:{...source.predictedWinner,decisionScore:null,branch:'net'}}),true);
 assert.equal(validComparisonSource({...source,predictedWinner:{side:null,name:null,decisionScore:.9,threshold:null,branch:null}}),false);
 const {decisionScore,...withoutScore}=source.predictedWinner;
 assert.equal(validComparisonSource({...source,predictedWinner:{...withoutScore,rawScore:decisionScore}}),false);
});
