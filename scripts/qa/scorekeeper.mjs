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
  const writes=[], errors=[];
  let failNext=false, holdNext=false, releaseSave=null;
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
  await page.goto(origin+'/qa-scorekeeper'+(scenario==='missing-own-clip'?'?case=missing-clip':''));
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
  return {page,writes,errors,selectPoint,fail:()=>{failNext=true;},hold:()=>{holdNext=true;},release:()=>releaseSave?.()};
}

try {
  for(const [surface,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:393,height:660}]]) {
    const regressions=['correction','clear','skip','paused-first-answer','live-first-answer','scrubbed-first-answer','auto-paused-first-answer','failed-clear','failed-undo','immediate-undo','undo-then-correction','undo-after-close','undo-after-reopen','undo-after-navigation','undo-after-pause','join-then-score','missing-own-clip'];
    const scenarios=process.env.QA_SCENARIO==='reference'
      ? ['reference']
      : regressions.filter(name=>!process.env.QA_SCENARIO||process.env.QA_SCENARIO===name);
    for(const scenario of scenarios) {
      const f=await fixture(viewport,scenario);
      try {
        if(scenario==='reference') {
          assert.deepEqual(f.errors,[],'no browser runtime errors');
          await f.page.screenshot({path:output+`qa-${surface}-reference.png`});
          results.push(`${surface} reference: PASS`);
          continue;
        }
        const firstAnswer=scenario.endsWith('first-answer')||scenario==='missing-own-clip';
        await f.selectPoint(firstAnswer?2:1,{paused:!['live-first-answer','scrubbed-first-answer','auto-paused-first-answer','missing-own-clip'].includes(scenario),...(scenario==='missing-own-clip'?{start:8}:{})});
        if(scenario==='missing-own-clip') {
          // A settled replay at the virtual start must still be ineligible
          // when the card's required standalone media could not load.
          await f.page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=8;});
          await f.page.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&v.currentTime===8;});
          await f.page.evaluate(()=>document.querySelector('video').play());
          await f.page.waitForFunction(()=>document.querySelector('video').currentTime>=8.2);
        }
        if(scenario==='join-then-score') {
          await f.page.getByRole('button',{name:/^Modify\s*split/}).click();
          const modal=f.page.getByRole('heading',{name:'Modify point',exact:true}).locator('..').locator('..');
          await modal.getByRole('button',{name:/^Join.*merge with next$/}).click();
          await modal.getByRole('button',{name:'Alex',exact:true}).click();
          await modal.getByRole('button',{name:'Join 2 points',exact:true}).click();
          const saved=f.page.waitForResponse(r=>r.request().method()==='PATCH' && new URL(r.url()).port==='3218').catch(()=>null);
          await modal.getByRole('button',{name:'Confirm — join 2 points',exact:true}).click();
          assert.ok(await saved,'winner save follows synthetic join');
          await f.page.getByRole('button',{name:'Go to point 1, Alex won',exact:true}).waitFor();
          assert.equal(await f.page.getByRole('button',{name:/^Go to point \d+,/}).count(),2,'merged-away card stays removed after scorer save');
          assert.match(await f.page.getByRole('button',{name:'Open point 1',exact:true}).innerText(),/15\.0s/,'survivor keeps joined timing');
          assert.equal(f.writes.length,1,'one winner write after join');
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
