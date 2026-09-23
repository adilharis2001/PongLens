import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingSuggestionKeys,displayLabel,confirmSuggestions,suggestionState,validSuggestion,reviewChangedFields,type EndingSuggestion} from './endingSuggestions.ts';
import {EMPTY_LABEL,normalizeEndingLabel,validEndingLabel} from './pointEndings.ts';
const suggestion:EndingSuggestion={version:1,runId:'contact-review-20260922-v1',reason:{value:'long',confidence:'tentative',detail:'Outgoing path.'},lastRallyContact:{value:'near',confidence:'tentative',detail:'Last detected contact.'},lastBounce:{value:'detected:0',confidence:'tentative',detail:'Candidate final bounce.'},events:[{id:'detected:0',kind:'table',side:'near',confidence:'tentative',detail:'Table contact.'},{id:'detected:1',kind:null,side:null,confidence:'uncertain',detail:'Unresolved.'}]};
test('suggestions display without becoming saved labels or notes',()=>{const label=structuredClone(EMPTY_LABEL);const shown=displayLabel(label,suggestion);assert.equal(shown.reason,'long');assert.equal(shown.bounceReview?.events.length,1);assert.equal(label.reason,null);assert.equal(shown.note,'');assert.equal(pendingSuggestionKeys(label,suggestion).length,4);});
test('human answers always win and confirming does not overwrite them',()=>{const label={...EMPTY_LABEL,reason:'net' as const,note:'My observation',bounceReview:{version:1 as const,events:[{id:'detected:0',kind:'paddle' as const,side:'far' as const}],lastBounce:null}};const confirmed=confirmSuggestions(label,suggestion);assert.equal(confirmed.reason,'net');assert.equal(confirmed.note,'My observation');assert.equal(confirmed.bounceReview?.events[0].kind,'paddle');assert.equal(confirmed.bounceReview?.lastBounce,null);assert.equal(validEndingLabel(confirmed),true);});
test('changing a note confirms no suggestions',()=>{const next=reviewChangedFields(EMPTY_LABEL,{...EMPTY_LABEL,note:'Check this'},suggestion);assert.equal(next.suggestionReview,undefined);assert.equal(next.reason,null);});
test('correcting only a reason leaves the contact and bounces unconfirmed',()=>{const next=reviewChangedFields(EMPTY_LABEL,{...EMPTY_LABEL,reason:'net'},suggestion);assert.deepEqual(next.suggestionReview?.fields,['reason']);assert.equal(suggestionState(next,suggestion,'reason'),'corrected');assert.equal(pendingSuggestionKeys(next,suggestion).length,3);assert.equal(next.bounceReview,undefined);});
test('explicit dismissal survives reload instead of revealing the suggestion again',()=>{const next=confirmSuggestions(EMPTY_LABEL,suggestion,['reason'],true);assert.equal(next.reason,null);assert.equal(displayLabel(next,suggestion).reason,null);assert.equal(suggestionState(next,suggestion,'reason'),'dismissed');});
test('confirmation preserves original suggestion, validates, and tracks acceptance',()=>{const original=structuredClone(suggestion);const next=confirmSuggestions(EMPTY_LABEL,suggestion);assert.deepEqual(suggestion,original);assert.equal(validEndingLabel(next),true);assert.equal(pendingSuggestionKeys(next,suggestion).length,0);assert.equal(suggestionState(next,suggestion,'event:detected:0'),'accepted');assert.deepEqual(normalizeEndingLabel(next).suggestionReview,next.suggestionReview);});
test('older clients preserve reviewed suggestion fields',()=>{const saved=confirmSuggestions(EMPTY_LABEL,suggestion,['reason']);assert.deepEqual(normalizeEndingLabel({...EMPTY_LABEL,reason:'long'},saved).suggestionReview,saved.suggestionReview);});
test('malformed and cross-point suggestion references are rejected',()=>{assert.equal(validSuggestion(suggestion,2),true);assert.equal(validSuggestion({...suggestion,events:[...suggestion.events,suggestion.events[0]]},2),false);assert.equal(validSuggestion({...suggestion,lastBounce:{...suggestion.lastBounce,value:'detected:2'}},2),false);assert.equal(validSuggestion({...suggestion,reason:{...suggestion.reason,value:'fake'}},2),false);});
test('correcting a proposed last bounce to a non-rally event dismisses the dependent suggestion',()=>{
 const next=reviewChangedFields(EMPTY_LABEL,{...EMPTY_LABEL,bounceReview:{version:1,events:[{id:'detected:0',kind:'floor',side:null}],lastBounce:null}},suggestion);
 assert.equal(suggestionState(next,suggestion,'lastBounce'),'dismissed');
 assert.equal(displayLabel(next,suggestion).bounceReview?.lastBounce,null);
});

test('a pending non-rally category cannot clear a saved human last-bounce mark',()=>{
 const s={version:1 as const,runId:'contact-review-20260922-v1',reason:{value:null,confidence:'uncertain' as const,detail:''},lastRallyContact:{value:null,confidence:'uncertain' as const,detail:''},lastBounce:{value:null,confidence:'uncertain' as const,detail:''},events:[{id:'detected:0',kind:'floor' as const,side:null,confidence:'tentative' as const,detail:''}]};
 const label={...EMPTY_LABEL,bounceReview:{version:1 as const,lastBounce:'detected:0',events:[]}};
 assert.equal(suggestionState(label,s,'event:detected:0'),'uncertain');
 assert.equal(displayLabel(label,s).bounceReview?.lastBounce,'detected:0');
 assert.equal(confirmSuggestions(label,s).bounceReview?.lastBounce,'detected:0');
});
