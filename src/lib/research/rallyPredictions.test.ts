import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RALLY_RUN_ID,LEGACY_RALLY_RUN_ID,finishRallyReview,confirmRallyBounce,reviewRallyBounce,validRallyPrediction,withoutLegacyLastBounce,type RallyPrediction} from './rallyPredictions.ts';
import {EMPTY_LABEL,normalizeEndingLabel,validEndingLabel} from './pointEndings.ts';
const p:RallyPrediction={version:1,runId:LEGACY_RALLY_RUN_ID,lastBounce:{id:'detected:1',rawTime:4,side:'far',origin:'detected',agreement:.65},winner:{side:'near',score:.85,threshold:.8},baselineWinner:null};
test('confirm changes only last bounce and its run provenance',()=>{
 const input={...EMPTY_LABEL,reason:'net' as const,note:'my note',bounceReview:{version:1 as const,events:[{id:'detected:0',kind:'paddle' as const,side:null}],lastBounce:null}};
 const result=confirmRallyBounce(input,p);assert.equal(result.bounceReview?.lastBounce,'detected:1');assert.equal(result.note,'my note');assert.equal(result.reason,'net');assert.deepEqual(input.bounceReview.events,result.bounceReview?.events);assert.equal(input.bounceReview.lastBounce,null);assert.equal(result.rallyReview?.runId,LEGACY_RALLY_RUN_ID);assert.ok(validEndingLabel(result));
});
test('a human last-bounce answer or non-rally annotation cannot be overwritten by confirm',()=>{
 const input={...EMPTY_LABEL,bounceReview:{version:1 as const,events:[],lastBounce:'detected:0'}};
 assert.equal(confirmRallyBounce(input,p),input);
 const blocked={...EMPTY_LABEL,bounceReview:{version:1 as const,events:[{id:'detected:1',kind:'floor' as const,side:null}],lastBounce:null}};
 assert.equal(confirmRallyBounce(blocked,p),blocked);
});
test('trajectory choice creates an added bounce only on explicit confirmation',()=>{
 const q={...p,lastBounce:{...p.lastBounce!,id:'added:11111111-1111-1111-1111-111111111111',origin:'trajectory' as const}};
 const result=confirmRallyBounce(EMPTY_LABEL,q);assert.equal(result.bounceReview?.events[0].rawTime,4);assert.ok(validEndingLabel(result));assert.equal(EMPTY_LABEL.bounceReview,undefined);
});
test('correction records new run without replacing previous review provenance',()=>{
 const before={...EMPTY_LABEL,suggestionReview:{runId:'contact-review-20260922-v1',fields:['reason']}};
 const after={...before,bounceReview:{version:1 as const,events:[],lastBounce:'detected:0'}};
 const result=reviewRallyBounce(before,after,p);assert.deepEqual(result.suggestionReview,before.suggestionReview);assert.equal(result.rallyReview?.runId,LEGACY_RALLY_RUN_ID);
 assert.deepEqual(normalizeEndingLabel(EMPTY_LABEL,result).rallyReview,result.rallyReview);
});
test('editing notes does not accept a prediction',()=>{assert.equal(reviewRallyBounce(EMPTY_LABEL,{...EMPTY_LABEL,note:'a'},p).rallyReview,undefined);});
test('invalid scores and detector references are rejected; missing winner score is explicit',()=>{
 assert.ok(validRallyPrediction(p,3,{start:0,end:10}));assert.equal(validRallyPrediction(p,1,{start:0,end:10}),false);
 assert.equal(validRallyPrediction({...p,winner:{...p.winner,score:NaN}},3,{start:0,end:10}),false);
 assert.equal(validRallyPrediction({...p,winner:{...p.winner,score:.6}},3,{start:0,end:10}),false);
 assert.equal(validRallyPrediction(p,3,{start:5,end:10}),false);
 assert.ok(validRallyPrediction({...p,lastBounce:null,winner:{side:null,score:null,threshold:null}},3,{start:0,end:10}));
});
test('new experiment suppresses old last-bounce autofill but preserves other suggestions',()=>{
 const s={version:1 as const,runId:'old',reason:{value:null,confidence:'uncertain' as const,detail:''},lastRallyContact:{value:null,confidence:'uncertain' as const,detail:''},lastBounce:{value:'detected:0',confidence:'tentative' as const,detail:'old'},events:[]};
 const out=withoutLegacyLastBounce(s,p)!;assert.equal(out.lastBounce.value,null);assert.equal(s.lastBounce.value,'detected:0');assert.equal(out.reason,s.reason);
});

const pose:RallyPrediction={...p,version:2,runId:RALLY_RUN_ID,ranking:{method:'ball_pose',margin:.4,poseCoverage:.8,candidateCount:3,reason:'available'}};
test('pose run validates evidence availability, margins and version while legacy remains readable',()=>{
 assert.ok(validRallyPrediction(p,3,{start:0,end:10}));assert.ok(validRallyPrediction(pose,3,{start:0,end:10}));
 for(const patch of [{margin:NaN},{margin:-1},{poseCoverage:1.1},{poseCoverage:.2},{candidateCount:1.2},{method:'ball_only'}])assert.equal(validRallyPrediction({...pose,ranking:{...pose.ranking,...patch}},3,{start:0,end:10}),false);
 assert.equal(validRallyPrediction({...pose,ranking:undefined},3,{start:0,end:10}),false);
 assert.equal(validRallyPrediction({...pose,version:1},3,{start:0,end:10}),false);
});
test('explicit no-live-bounce outcome preserves annotations and survives normalization; uncertainty is distinct',()=>{
 const label={...EMPTY_LABEL,note:'my note',bounceReview:{version:1 as const,events:[{id:'detected:0',kind:'net_bounce' as const,side:null}],lastBounce:null}};
 const none=finishRallyReview(label,pose,'no_live_bounce');
 assert.deepEqual(none.bounceReview,label.bounceReview);assert.equal(none.note,label.note);assert.equal(none.rallyReview?.outcome,'no_live_bounce');
 assert.ok(validEndingLabel(none));assert.deepEqual(normalizeEndingLabel(EMPTY_LABEL,none).rallyReview,none.rallyReview);
 const unsure=finishRallyReview(label,pose,'uncertain');assert.equal(unsure.rallyReview?.outcome,'uncertain');
 assert.equal(validEndingLabel({...none,rallyReview:{...none.rallyReview,outcome:'bad'}}),false);
});
test('explicit no-live-bounce action clears only the last designation and retains bounce annotations',()=>{
 const label={...EMPTY_LABEL,bounceReview:{version:1 as const,events:[],lastBounce:'detected:0'}};
 const cleared=finishRallyReview(label,pose,'no_live_bounce');assert.equal(cleared.bounceReview?.lastBounce,null);assert.deepEqual(cleared.bounceReview?.events,label.bounceReview.events);assert.equal(label.bounceReview.lastBounce,'detected:0');
 assert.equal(finishRallyReview(label,pose,'kept').bounceReview?.lastBounce,'detected:0');
});
