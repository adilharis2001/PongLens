// Run only against the synthetic fixture described in fixtures/scorekeeper-page.tsx.
// All application API calls and database writes are intercepted in this browser.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile, mkdir} from 'node:fs/promises';

const origin='http://127.0.0.1:3217';
const output=new URL('../../.superpowers/sdd/2026-09-11-scorekeeper-containment/',import.meta.url).pathname;
const movie=await readFile('/private/tmp/ponglens-scorekeeper-fixture.mp4');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];

async function fixture(viewport, scenario) {
  const page=await browser.newPage({viewport});
  page.setDefaultTimeout(15000);
  const writes=[], errors=[], splits=[], unsplits=[];
  let failNext=false, holdNext=false, releaseSave=null;
  // Synthetic rows for the split machinery: split_point moves the parent's
  // end and hands back the tail as a new row, which is the whole contract
  // the pad depends on. Seeded with the fixture's own point 2.
  const rows=new Map([['33333333-3333-4333-8333-000000000002',
    {id:'33333333-3333-4333-8333-000000000002',idx:2,t0:10,t1:16,cut_t0:9,tight_start:false,tight_end:false}]]);
  let nextIdx=3;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(), url=new URL(request.url());
    if(url.pathname==='/fixture.mp4') {
      const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers().range??'');
      const start=range?Number(range[1]):0;
      const end=range&&range[2]?Math.min(Number(range[2]),movie.length-1):movie.length-1;
      return route.fulfill({status:range?206:200,contentType:'video/mp4',body:movie.subarray(start,end+1),
        headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${movie.length}`}:{})}});
    }
    if(url.pathname==='/api/media-url') {
      if(scenario==='missing-own-clip' && request.postDataJSON()?.pointId?.endsWith('000000000002')) return route.fulfill({status:503,json:{error:'Synthetic clip URL failure'}});
      return route.fulfill({json:{url:origin+'/fixture.mp4',available:true}});
    }
    if(url.port==='3218') {
      if(url.pathname==='/rest/v1/rpc/split_point') {
        const body=request.postDataJSON();
        splits.push(body);
        const parent=rows.get(body.p_id);
        assert.ok(parent,'split_point targets a known row');
        const child={id:`44444444-4444-4444-8444-${String(splits.length).padStart(12,'0')}`,
          match_id:'22222222-2222-4222-8222-222222222222',idx:++nextIdx,
          t0:body.at_t,t1:parent.t1,cut_t0:body.child_cut_t0,clip_path:'fixture-cut.mp4',
          server:'user',server_override:null,is_let:false,placement:null,suggestion:null,
          confirmed_winner:null,scored_at_cut_s:null,rally_end_cut_s:null,confirmed_how:null,
          starred:false,deleted:false,edited:true,tight_start:true,tight_end:parent.tight_end,
          game_end_override:null,game_winner_override:null,side_change_dismissed:false};
        rows.set(child.id,{id:child.id,idx:child.idx,t0:child.t0,t1:child.t1,cut_t0:child.cut_t0,
          tight_start:true,tight_end:parent.tight_end});
        parent.t1=body.at_t;
        return route.fulfill({json:child});
      }
      if(url.pathname==='/rest/v1/rpc/unsplit_point') {
        const body=request.postDataJSON();
        unsplits.push(body);
        const parent=rows.get(body.p_parent);
        if(parent) parent.t1=body.parent_t1;
        rows.delete(body.p_child);
        return route.fulfill({json:null});
      }
      if(url.pathname==='/rest/v1/rpc/merge_points') {
        assert.equal(request.method(),'POST');
        assert.deepEqual(request.postDataJSON().p_ids,[1,2].map(i=>`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`));
        return route.fulfill({json:{id:'33333333-3333-4333-8333-000000000001',match_id:'22222222-2222-4222-8222-222222222222',idx:1,
          t0:1,t1:16,cut_t0:0,confirmed_winner:'user',is_let:false,scored_at_cut_s:6,
          tight_start:false,tight_end:false,edited:true,deleted:false,clip_path:'fixture-cut.mp4'}});
      }
      if(request.method()==='PATCH') {
        const patch=JSON.parse(request.postData());
        writes.push({id:url.searchParams.get('id'),patch,failed:failNext});
        if(holdNext) {holdNext=false;await new Promise(resolve=>{releaseSave=resolve;});}
        if(failNext) {failNext=false;return route.fulfill({status:500,json:{message:'Synthetic save failure'}});}
      }
      return route.fulfill({status:200,json:[],headers:{'Access-Control-Allow-Origin':'*'}});
    }
    if(url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
    if(url.hostname!=='127.0.0.1') return route.abort();
    return route.continue();
  });
  await page.goto(origin+'/qa-scorekeeper'+(scenario==='early-handoff'?'?case=handoff':scenario==='missing-own-clip'?'?case=missing-clip':scenario==='scorekeeper-tap-stop'||scenario==='early-live-winner-tap-stop'?'?full-card=off':''));
  await page.getByRole('button',{name:/Score the Match/}).click();
  await page.getByRole('button',{name:'Undo last tap',exact:true}).waitFor();
  const serveSwitch=page.getByRole('switch',{name:'You serve. Press to give the serve to Alex.',exact:true});
  await serveSwitch.waitFor();
  assert.equal(await serveSwitch.count(),1,'current named serve switch is present');
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.readyState>=2));
  async function selectPoint(number,{paused=true,start=(number-1)*9}={}) {
    await page.getByRole('button',{name:new RegExp(`^Go to point ${number},`)}).click();
    await page.waitForFunction(start=>{
      const v=[...document.querySelectorAll('video')].find(v=>v.currentSrc.includes('fixture.mp4'));
      return v && !v.seeking && v.currentTime>=start && v.currentTime<start+2;
    },start);
    if(paused) await page.evaluate(()=>document.querySelector('video').pause());
  }
  return {page,writes,errors,splits,unsplits,selectPoint,fail:()=>{failNext=true;},hold:()=>{holdNext=true;},release:()=>releaseSave?.()};
}

try {
  for(const [surface,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:393,height:660}]]) {
    const regressions=['correction','clear','skip','paused-first-answer','live-first-answer','scrubbed-first-answer','auto-paused-first-answer','failed-clear','failed-undo','immediate-undo','undo-then-correction','undo-after-close','undo-after-reopen','undo-after-navigation','undo-after-pause','join-then-score','backward-join-then-score','missing-own-clip','scorekeeper-full-card','scorekeeper-tap-stop'];
    const earlyScenarios=['early-winner-me','early-winner-opponent','early-skip','early-live-winner','early-live-skip','early-live-winner-tap-stop','early-let-key','early-skip-key','early-second-winner','early-second-skip','early-second-winner-let','early-second-again','early-second-undo','early-armed-modify','early-skip-undo','early-skip-failure','early-winner-failure','early-skip-delayed-failure','early-skip-reopen','late-skip','threshold-skip','early-correction','early-skip-navigation','early-skip-resume'];
    const scenarios=['reference','early-reference'].includes(process.env.QA_SCENARIO)
      ? [process.env.QA_SCENARIO]
      : [...regressions,...earlyScenarios,'early-handoff'].filter(name=>!process.env.QA_SCENARIO||process.env.QA_SCENARIO===name||(process.env.QA_SCENARIO==='early'&&(earlyScenarios.includes(name)||name==='early-handoff')));
    for(const scenario of scenarios) {
      const f=await fixture(viewport,scenario);
      try {
        if(scenario==='early-handoff') {
          await f.selectPoint(1,{paused:false});
          await f.page.waitForFunction(()=>document.querySelector('video').currentTime>=2);
          await f.page.locator('#full-video-card').getByRole('button',{name:'Alex',exact:true}).click();
          const nudge=f.page.getByText(/Point 1.*two points/);
          await nudge.waitFor();
          await f.page.waitForFunction(()=>{const videos=[...document.querySelectorAll('video')];return videos.length>1&&!videos[1].paused&&videos[1].currentTime>.25;});
          assert.equal(await nudge.count(),1,'natural handoff to an own clip preserves the active offer');
          await nudge.waitFor({state:'hidden'});
          assert.ok(await f.page.evaluate(()=>[...document.querySelectorAll('video')].some(v=>!v.paused)),'offered tail advances without stopping the active clip');
          assert.deepEqual(f.errors,[],'no browser runtime errors');
          results.push(`${surface} ${scenario}: PASS`);
          continue;
        }
        if(scenario==='reference') {
          assert.deepEqual(f.errors,[],'no browser runtime errors');
          await f.page.screenshot({path:output+`qa-${surface}-reference.png`});
          results.push(`${surface} reference: PASS`);
          continue;
        }
        if(earlyScenarios.includes(scenario)||scenario==='early-reference') {
          // Real Player handlers and real media, with only the external save
          // replaced. The break this catches is Skip bypassing the split
          // offer, or an early outcome interrupting playback for its offer.
          const correction=scenario==='early-correction';
          const live=scenario.startsWith('early-live-');
          const late=scenario==='late-skip'||scenario==='threshold-skip';
          // The armed scenarios answer from further into the card, so the
          // mark the second answer cuts at lands inside the point's own
          // window rather than clamped onto its first legal frame.
          const second=scenario.startsWith('early-second')||scenario==='early-armed-modify';
          await f.selectPoint(correction?1:2,{paused:!live});
          const at=correction?2:scenario==='threshold-skip'?13.5:late?15:second?12.5:10;
          if(live) {
            await f.page.waitForFunction(()=>document.querySelector('video').currentTime>=10);
          } else {
            await f.page.evaluate(at=>{const v=document.querySelector('video');v.pause();v.currentTime=at;},at);
            await f.page.waitForFunction(at=>{const v=document.querySelector('video');return !v.seeking&&Math.abs(v.currentTime-at)<.02;},at);
          }
          if(scenario.endsWith('failure')) f.fail();
          if(scenario==='early-skip-delayed-failure') f.hold();
          const winner=scenario.includes('winner')||scenario==='early-armed-modify'||scenario==='early-reference';
          if(scenario==='early-let-key'||scenario==='early-skip-key') await f.page.keyboard.press(scenario==='early-let-key'?'l':'k');
          else if(winner) await f.page.locator('#full-video-card').getByRole('button',{name:scenario==='early-winner-me'?'Me':'Alex',exact:true}).click();
          else await f.page.getByRole('button',{name:/^Skip\s*let$/}).click();
          const nudge=f.page.getByText(/Point 2.*two points/);
          if(scenario==='early-reference') {
            await nudge.waitFor();
            await f.page.screenshot({path:output+`qa-${surface}-early-reference.png`});
            results.push(`${surface} ${scenario}: PASS`);
            continue;
          }
          if(scenario.endsWith('failure')) {
            if(scenario==='early-skip-delayed-failure') {
              await nudge.waitFor();
              await f.page.waitForFunction(()=>document.querySelector('video').currentTime>=16);
              f.release();
            }
            await f.page.getByText("Couldn't save. Tap again.",{exact:true}).waitFor();
            assert.equal(await nudge.count(),0,'failed outcome retires its split offer');
            assert.equal(await f.page.evaluate(()=>document.querySelector('video').paused),false,'failed early answer does not interrupt playback');
            if(scenario==='early-skip-delayed-failure') {
              await f.page.waitForFunction(()=>document.querySelector('video').paused);
              const at=await f.page.evaluate(()=>document.querySelector('video').currentTime);
              assert.ok(at>=17&&at<18,'failed save restores the unanswered card boundary instead of silently advancing');
            }
          } else if(late||correction) {
            assert.equal(await nudge.count(),0,'late answer/correction does not offer a split');
            if(late) await f.page.waitForFunction(()=>document.querySelector('video').currentTime>=18);
            else assert.ok(Math.abs(await f.page.evaluate(()=>document.querySelector('video').currentTime)-2)<.05,'correction stays on current point');
          } else {
            await nudge.waitFor();
            const state=await f.page.evaluate(()=>{const v=document.querySelector('video');return {paused:v.paused,t:v.currentTime};});
            assert.equal(state.paused,false,'early outcome keeps playing while Split/No is offered');
            assert.ok(state.t>=at&&state.t<at+2,'early outcome does not seek away');
            await f.page.waitForTimeout(350);
            assert.ok(await f.page.evaluate(()=>document.querySelector('video').currentTime)>state.t+.15,'footage continues while deciding');
            if(second) {
              // THE SECOND ANSWER. While the arm is up the winner buttons
              // mean "who won the rally that just finished": one tap cuts
              // the card at the arm's mark and scores the new half, with no
              // editor in the way. Modify stays the way to place a cut by
              // hand, and while armed it opens on that same mark.
              const cards=()=>f.page.getByRole('button',{name:/^Go to point \d+,/}).count();
              assert.equal(await cards(),3,'three cards before the second answer');
              if(scenario==='early-armed-modify') {
                // Both doors to the editor: the hint's own Split pill, kept
                // for anyone who would rather see the cut before it lands.
                await f.page.getByRole('button',{name:'Split',exact:true}).click();
                await f.page.getByRole('heading',{name:'Modify point',exact:true}).waitFor();
                assert.equal(await f.page.evaluate(()=>document.querySelector('video').paused),true,'Modify opens paused while armed');
                assert.equal(await nudge.count(),0,'the arm retires when the editor opens');
                assert.deepEqual(f.splits,[],'opening the editor cuts nothing by itself');
              } else if(scenario==='early-second-winner-let') {
                // Skip is the third answer to the same question: it must cut
                // the card exactly as a winner does and make the new half the
                // let, without stopping the footage the way it used to.
                await f.page.getByRole('button',{name:/^Skip\s*let$/}).click();
                await f.page.waitForFunction(()=>document.querySelectorAll('[aria-label^="Go to point"]').length===4);
                assert.equal(f.splits.length,1,'a let in there cuts the card too');
                assert.ok(Math.abs(f.splits[0].at_t-11.9)<.01,'and cuts it in the same place');
                const lets=f.writes.filter(w=>w.patch.is_let===true);
                assert.equal(lets.length,1,'one let, and it is not the card already answered');
                assert.ok(lets[0].id.includes('44444444'),`the let lands on the new half, got ${lets[0].id}`);
                assert.equal(lets[0].patch.confirmed_winner,null);
                assert.equal(await f.page.evaluate(()=>document.querySelector('video').paused),false,'a let never stops the footage');
              } else {
                assert.equal(await f.page.getByRole('button',{name:'Split',exact:true}).count(),1,'the explicit Split route stays on offer beside the buttons');
                await f.page.locator('#full-video-card').getByRole('button',{name:'Me',exact:true}).click();
                await f.page.getByRole('button',{name:'Go to point 3, Me won',exact:true}).waitFor();
                assert.equal(await cards(),4,'the second answer adds a card');
                assert.equal(f.splits.length,1,'one cut, from one tap');
                assert.equal(f.splits[0].p_id,'33333333-3333-4333-8333-000000000002','the cut lands on the armed card');
                assert.ok(Math.abs(f.splits[0].at_t-11.9)<.01,`cut a beat before the first answer, got ${f.splits[0].at_t}`);
                assert.ok(Math.abs(f.splits[0].child_cut_t0-11.6)<.01,`child keeps the tight-split anchor, got ${f.splits[0].child_cut_t0}`);
                const scored=f.writes.filter(w=>w.patch.confirmed_winner==='user');
                assert.equal(scored.length,1,'the new half is scored by the same tap');
                assert.equal(scored[0].patch.scored_at_cut_s,null,'a hand-cut half takes no tap-derived ending, so its whole tail stays playable');
                assert.equal(await f.page.evaluate(()=>document.querySelector('video').paused),false,'answering again never stops the footage');
                if(scenario==='early-second-again') {
                  // A third rally works by repetition, not by a third
                  // control: the new half arms in turn while footage runs.
                  const again=f.page.getByText(/Point 3.*two points/);
                  await again.waitFor();
                  await f.page.locator('#full-video-card').getByRole('button',{name:'Alex',exact:true}).click();
                  await f.page.getByRole('button',{name:'Go to point 4, Alex won',exact:true}).waitFor();
                  assert.equal(f.splits.length,2,'the second cut comes from the second armed tap');
                  assert.equal(await cards(),5,'one card became three');
                } else if(scenario==='early-second-undo') {
                  await f.page.getByRole('button',{name:'Undo last tap',exact:true}).click();
                  await f.page.waitForFunction(()=>document.querySelectorAll('[aria-label^="Go to point"]').length===3);
                  assert.equal(f.unsplits.length,1,'Undo puts the halves back together');
                  assert.equal(f.unsplits[0].parent_t1,16,"the card's own end comes back");
                }
              }
            } else if(scenario.endsWith('-undo')) {
              await f.page.getByRole('button',{name:'Undo last tap',exact:true}).click();
              await f.page.waitForFunction(()=>document.querySelector('video').currentTime<10);
              assert.equal(await nudge.count(),0,'Undo retires the early-outcome offer');
            } else if(scenario.endsWith('-navigation')) {
              await f.selectPoint(3);
              assert.equal(await nudge.count(),0,'point navigation retires old offer');
            } else if(scenario.endsWith('-reopen')) {
              await f.page.getByRole('button',{name:'Close player',exact:true}).click();
              await f.page.getByRole('button',{name:'Close player',exact:true}).waitFor({state:'hidden'});
              await f.page.getByRole('button',{name:/Score the Match/}).click();
              assert.equal(await nudge.count(),0,'reopening starts without an offer from the previous session');
            } else if(scenario.endsWith('-resume')||scenario==='early-live-winner-tap-stop') {
              // A deliberate pause/resume on this same card must not lose
              // the offer; leaving the card must retire it without a hold.
              if(scenario.endsWith('-resume')) {
                await f.page.evaluate(()=>document.querySelector('video').pause());
                if(surface==='desktop') await f.page.keyboard.press('Space');
                else await f.page.locator('#full-video-card').getByRole('button',{name:'Play',exact:true}).click();
                await f.page.waitForFunction(()=>!document.querySelector('video').paused);
              }
              await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
              await f.page.evaluate(()=>{const v=document.querySelector('video');window.qaUnexpectedPauses=0;v.addEventListener('pause',()=>window.qaUnexpectedPauses++);v.playbackRate=4;});
              await f.page.waitForFunction(()=>document.querySelector('video').currentTime>=18);
              await nudge.waitFor({state:'hidden',timeout:2000});
              assert.equal(await f.page.evaluate(()=>document.querySelector('video').paused),false,'offered tail advances without a split-specific pause');
              assert.equal(await f.page.evaluate(()=>window.qaUnexpectedPauses),0,'no pause event interrupts the offered tail');
              assert.equal(await nudge.count(),0,'leaving the card retires old offer');
            }
          }
          assert.deepEqual(f.errors,[],'no browser runtime errors');
          assert.ok(f.writes.length>=1,'outcome was submitted');
          const patch=f.writes[0].patch;
          if(live&&winner) assert.ok(patch.scored_at_cut_s>=10&&patch.scored_at_cut_s<12,'live winner keeps its valid ending observation while playback continues');
          assert.deepEqual(patch,{confirmed_winner:winner?(scenario==='early-winner-me'?'user':'opponent'):null,is_let:!winner,scored_at_cut_s:live&&winner?patch.scored_at_cut_s:null},'save retains winner/Skip semantics and paused timing policy');
          await f.page.screenshot({path:output+`qa-${surface}-${scenario}.png`,animations:'disabled'});
          results.push(`${surface} ${scenario}: PASS`);
          continue;
        }
        if(['scorekeeper-full-card','scorekeeper-tap-stop'].includes(scenario)) {
          await f.selectPoint(1,{paused:false});
          const expected=scenario==='scorekeeper-full-card'?8:6.5;
          await f.page.waitForFunction(expected=>{const v=document.querySelector('video');return v.paused&&v.currentTime>=expected-0.05;},expected);
          const time=await f.page.evaluate(()=>document.querySelector('video').currentTime);
          // Current playback pauses on the next ~250ms media tick; it does
          // not seek backward onto the exact threshold. Preserve that policy.
          assert.ok(time>=expected-0.05&&time<expected+0.35,`current playback policy stops at the first media tick after ${expected}, got ${time}`);
          assert.deepEqual(f.writes,[],'playback policy alone does not write score or ending');
          assert.deepEqual(f.errors,[],'no browser runtime errors');
          await f.page.screenshot({path:output+`qa-${surface}-${scenario}.png`});
          results.push(`${surface} ${scenario}: PASS`);
          continue;
        }
        const firstAnswer=scenario.endsWith('first-answer')||scenario==='missing-own-clip';
        await f.selectPoint(firstAnswer||scenario==='backward-join-then-score'?2:1,{paused:!['live-first-answer','scrubbed-first-answer','auto-paused-first-answer','missing-own-clip'].includes(scenario),...(scenario==='missing-own-clip'?{start:8}:{})});
        if(scenario==='missing-own-clip') {
          // A settled replay at the virtual start must still be ineligible
          // when the card's required standalone media could not load.
          await f.page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=8;});
          await f.page.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&v.currentTime===8;});
          await f.page.evaluate(()=>document.querySelector('video').play());
          await f.page.waitForFunction(()=>document.querySelector('video').currentTime>=8.2);
        }
        if(['join-then-score','backward-join-then-score'].includes(scenario)) {
          await f.page.getByRole('button',{name:/^Modify\s*split/}).click();
          const modal=f.page.getByRole('heading',{name:'Modify point',exact:true}).locator('..').locator('..');
          await modal.getByRole('button',{name:/^Join\s*merge neighbours$/}).click();
          const direction=modal.getByRole('button',{name:scenario==='backward-join-then-score'?'← Previous':'Next →',exact:true});
          assert.equal(await direction.getAttribute('aria-pressed'),'true','current default Join direction is retained');
          await modal.getByRole('button',{name:'Alex',exact:true}).click();
          await modal.getByRole('button',{name:'Join 2 points',exact:true}).click();
          const saved=f.page.waitForResponse(r=>r.request().method()==='PATCH' && new URL(r.url()).port==='3218').catch(()=>null);
          await modal.getByRole('button',{name:'Confirm — join 2 points',exact:true}).click();
          assert.ok(await saved,'winner save follows synthetic join');
          await f.page.getByRole('button',{name:'Go to point 1, Alex won',exact:true}).waitFor();
          assert.equal(await f.page.getByRole('button',{name:/^Go to point \d+,/}).count(),2,'merged-away card stays removed after scorer save');
          assert.match(await f.page.getByRole('button',{name:'Open point 1',exact:true}).innerText(),/15\.0s/,'survivor keeps joined timing');
          assert.equal(f.writes.length,1,'one winner write after join');
          assert.equal(f.writes[0].id,'eq.33333333-3333-4333-8333-000000000001','score targets surviving point even when joining backward');
          assert.equal(f.writes[0].patch.confirmed_winner,'opponent');
          assert.equal(f.writes[0].patch.scored_at_cut_s,6,'winner-only correction preserves survivor ending');
          assert.deepEqual(f.errors,[],'no browser runtime errors');
          await f.page.screenshot({path:output+`qa-${surface}-${scenario}.png`});
          results.push(`${surface} ${scenario}: PASS`);
          continue;
        }
        if(scenario==='live-first-answer') await f.page.waitForFunction(()=>document.querySelector('video').currentTime>=10);
        if(scenario==='auto-paused-first-answer') await f.page.waitForFunction(()=>{const v=document.querySelector('video');return v.paused&&v.currentTime>=17;});
        if(scenario==='scrubbed-first-answer') {
          await f.page.evaluate(()=>{document.querySelector('video').currentTime=12;});
          await f.page.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&v.currentTime>=12;});
        }
        if(scenario==='failed-clear') f.fail();
        if(['immediate-undo','undo-then-correction'].includes(scenario)) f.hold();
        const action=scenario==='skip'
          ? f.page.getByRole('button',{name:/^Skip\s*let$/})
          : f.page.locator('#full-video-card').getByRole('button',{name:['clear','failed-clear','failed-undo','immediate-undo','undo-then-correction','undo-after-close','undo-after-reopen','undo-after-navigation','undo-after-pause'].includes(scenario)?'Me':'Alex',exact:true});
        // Register the response wait before the click so a fast local response is not missed.
        const wait=f.page.waitForResponse(r=>r.request().method()==='PATCH' && new URL(r.url()).port==='3218').catch(()=>null);
        const firstRequest=f.page.waitForRequest(r=>r.method()==='PATCH' && new URL(r.url()).port==='3218').catch(()=>null);
        await action.click();
        if(['immediate-undo','undo-then-correction'].includes(scenario)) {
          assert.ok(await firstRequest,'score request is pending');
          await f.page.getByRole('button',{name:'Undo last tap',exact:true}).click();
          assert.equal(f.writes.length,1,'Undo does not overtake pending score save');
          if(scenario==='undo-then-correction') {
            const corrected=f.page.waitForResponse(r=>r.request().method()==='PATCH' && r.request().postDataJSON()?.confirmed_winner==='opponent').catch(()=>null);
            await f.page.locator('#full-video-card').getByRole('button',{name:'Alex',exact:true}).click();
            assert.equal(f.writes.length,1,'later correction also waits for pending save');
            f.release();
            assert.ok(await corrected,'later correction finishes');
            assert.equal(f.writes.length,3,'clear, Undo, correction persist in invocation order');
            assert.deepEqual(f.writes[1].patch,{confirmed_winner:'user',is_let:false,scored_at_cut_s:6});
            assert.deepEqual(f.writes[2].patch,{confirmed_winner:'opponent',is_let:false,scored_at_cut_s:6});
            await f.page.getByRole('button',{name:'Go to point 1, Alex won',exact:true}).waitFor();
            assert.deepEqual(f.errors,[],'no browser runtime errors');
            await f.page.screenshot({path:output+`qa-${surface}-${scenario}.png`});
            results.push(`${surface} ${scenario}: PASS`);
            continue;
          }
          const restored=f.page.waitForResponse(r=>r.request().method()==='PATCH' && r.request().postDataJSON()?.confirmed_winner==='user').catch(()=>null);
          f.release();
          assert.ok(await restored,'Undo save follows successful score save');
          await f.page.getByRole('button',{name:'Go to point 1, Me won',exact:true}).waitFor();
          assert.equal(f.writes.length,2,'pending clear followed by one restore');
          assert.deepEqual(f.writes[1].patch,{confirmed_winner:'user',is_let:false,scored_at_cut_s:6});
          results.push(`${surface} ${scenario}: PASS`);
          continue;
        }
        assert.ok(await wait,'score save request observed');
        assert.equal(f.writes.length,1,'one coupled save for the score action');
        assert.equal(f.writes[0].id,`eq.33333333-3333-4333-8333-${String(firstAnswer?2:1).padStart(12,'0')}`,'the displayed target is the saved point');
        const patch=f.writes.at(-1).patch;
        if(scenario==='live-first-answer') assert.ok(patch.scored_at_cut_s>=9&&patch.scored_at_cut_s<17,'continuous first answer captures actual cut time');
        else assert.equal(patch.scored_at_cut_s,scenario==='correction'?6:null);
        if(scenario==='correction') assert.equal(patch.confirmed_winner,'opponent');
        if(scenario==='skip') {assert.equal(patch.is_let,true);assert.equal(patch.confirmed_winner,null);}
        if(['undo-after-close','undo-after-reopen','undo-after-navigation','undo-after-pause'].includes(scenario)) {
          f.hold();
          const restoreRequest=f.page.waitForRequest(r=>r.method()==='PATCH' && r.postDataJSON()?.confirmed_winner==='user').catch(()=>null);
          const restored=f.page.waitForResponse(r=>r.request().method()==='PATCH' && r.request().postDataJSON()?.confirmed_winner==='user').catch(()=>null);
          await f.page.getByRole('button',{name:'Undo last tap',exact:true}).click();
          assert.ok(await restoreRequest,'Undo restoration is pending');
          if(!['undo-after-navigation','undo-after-pause'].includes(scenario)) {
            await f.page.getByRole('button',{name:'Close player',exact:true}).click();
            await f.page.getByRole('button',{name:'Close player',exact:true}).waitFor({state:'hidden'});
            assert.equal(await f.page.evaluate(()=>document.querySelector('video').paused),true,'closing pauses playback');
          }
          if(scenario==='undo-after-reopen') {
            await f.page.getByRole('button',{name:/Score the Match/}).click();
            await f.selectPoint(3);
          }
          if(scenario==='undo-after-navigation') await f.selectPoint(3);
          if(scenario==='undo-after-pause') {
            if(surface==='desktop') {
              // Exercise the shipped Space shortcut. The local Next dev
              // indicator overlaps the desktop transport button.
              if(await f.page.evaluate(()=>document.querySelector('video').paused)) await f.page.keyboard.press('Space');
              await f.page.waitForFunction(()=>!document.querySelector('video').paused);
              await f.page.keyboard.press('Space');
            } else {
              if(await f.page.evaluate(()=>document.querySelector('video').paused)) await f.page.locator('#full-video-card').getByRole('button',{name:'Play',exact:true}).click();
              await f.page.locator('#full-video-card').getByRole('button',{name:'Pause',exact:true}).click();
            }
            await f.page.waitForFunction(()=>document.querySelector('video').paused);
          }
          f.release();
          assert.ok(await restored,'Undo restoration completes');
          await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          assert.equal(f.writes.length,2,'score restoration still commits after leaving its viewing session');
          assert.equal(await f.page.evaluate(()=>document.querySelector('video').paused),true,'old Undo completion does not restart playback');
          if(['undo-after-reopen','undo-after-navigation'].includes(scenario)) assert.ok(Math.abs(await f.page.evaluate(()=>document.querySelector('video').currentTime)-18)<0.1,'new navigation stays on chosen point');
          assert.deepEqual(f.errors,[],'no browser runtime errors');
          await f.page.screenshot({path:output+`qa-${surface}-${scenario}.png`});
          results.push(`${surface} ${scenario}: PASS`);
          continue;
        }
        if(scenario==='failed-clear') {
          await f.page.getByText("Couldn't save. Tap again.",{exact:true}).waitFor();
          await f.page.getByRole('button',{name:'Go to point 1, Me won',exact:true}).waitFor();
          assert.equal(await f.page.getByRole('button',{name:'Undo last tap',exact:true}).isDisabled(),true);
        } else if(!firstAnswer) {
          const undo=f.page.getByRole('button',{name:'Undo last tap',exact:true});
          await undo.waitFor();
          if(scenario==='failed-undo') {
            f.fail();
            const failedRestore=f.page.waitForResponse(r=>r.request().method()==='PATCH' && new URL(r.url()).port==='3218').catch(()=>null);
            await undo.click();
            assert.equal((await failedRestore)?.status(),500,'synthetic Undo save fails');
            await f.page.waitForFunction(()=>!document.querySelector('button[aria-label="Undo last tap"]').disabled);
            assert.equal(f.writes.length,2,'failed Undo performs one coupled restore attempt');
            await f.page.screenshot({path:output+`qa-${surface}-failed-undo-message.png`});
          }
          const waitUndo=f.page.waitForResponse(r=>r.request().method()==='PATCH' && new URL(r.url()).port==='3218').catch(()=>null);
          await undo.click();assert.ok(await waitUndo,'Undo save request observed');
          assert.equal(f.writes.length,scenario==='failed-undo'?3:2,'Undo restores all scorer fields in one save');
          assert.deepEqual(f.writes.at(-1).patch,{confirmed_winner:'user',is_let:false,scored_at_cut_s:6});
          await f.page.getByRole('button',{name:'Go to point 1, Me won',exact:true}).waitFor();
        }
        assert.deepEqual(f.errors,[],'no browser runtime errors');
        await f.page.screenshot({path:output+`qa-${surface}-${scenario}.png`});
        results.push(`${surface} ${scenario}: PASS`);
      } catch(error) {
        await f.page.screenshot({path:output+`qa-${surface}-${scenario}-failed.png`});
        results.push(`${surface} ${scenario}: FAIL ${error.message}`);
        console.log(results.at(-1));
      } finally {f.release();await f.page.close();}
    }
  }
} finally {await browser.close();}
console.log(results.join('\n'));
assert.ok(results.every(row=>row.endsWith('PASS')),'all synthetic desktop/mobile scorer interactions pass');
