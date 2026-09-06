// Authenticated real-page interaction check. Only label writes are intercepted;
// research media and sample reads are real. Never prints auth or signed URLs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
process.loadEnvFile('.env.local');
const base = process.env.QA_BASE ?? 'http://localhost:3047';
let browser;
try {
  const key = execFileSync('security', ['find-generic-password','-a','openclaw','-s','ponglens-service-role','-w'], {encoding:'utf8'}).trim();
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({type:'magiclink',email:'adilharis2001@gmail.com'})});
  const link = await response.json();
  assert.ok(link.hashed_token);
  browser = await chromium.launch();
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  await context.request.get(`${base}/auth/confirm?token_hash=${link.hashed_token}&type=email&next=/research/active-ball`,{maxRedirects:0});
  const page = await context.newPage();
  await page.goto(`${base}/research/active-ball`);
  assert.equal(await page.getByRole('button',{name:'Replay clip',exact:true}).count(),1,'Review must provide motion context');
  await page.waitForFunction(()=>document.querySelector('img[alt="Frame to label"]')?.naturalWidth>0);
  const image = page.getByAltText('Frame to label');
  await page.getByRole('button',{name:'Replay clip',exact:true}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v && v.currentTime>.1 && !v.paused;});
  await page.getByRole('button',{name:'Mark this frame',exact:true}).click();
  await image.waitFor({state:'visible'});
  assert.equal(await image.isVisible(),true,'Manual return should show the still');
  await page.getByRole('button',{name:'Replay clip',exact:true}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v && v.currentTime>.1 && !v.paused;});
  await image.waitFor({state:'visible',timeout:15000});
  let attempted;
  await page.route('**/api/research/active-ball',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    attempted=route.request().postDataJSON();
    await route.fulfill({status:500,json:{error:'Test save failure'}});
  });
  const before = await page.locator('[data-sample-id]').getAttribute('data-sample-id');
  await image.click({position:{x:120,y:90}});
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Venue"]')?.disabled);
  assert.equal(await page.getByLabel('Venue',{exact:true}).isDisabled(),true,'Unsaved mark must lock filters');
  assert.equal(await page.getByRole('button',{name:'Skip for now →',exact:true}).isDisabled(),true,'Unsaved mark must lock navigation');
  await page.getByRole('button',{name:'Save and next',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Test save failure'}).waitFor();
  assert.equal(await page.locator('[data-sample-id]').getAttribute('data-sample-id'),before,'Failed save must preserve the current sample');
  assert.equal(attempted.id,before);
  assert.equal(attempted.label.state,'visible');
  await page.unroute('**/api/research/active-ball');
  await page.route('**/api/research/active-ball',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const body=route.request().postDataJSON();
    await route.fulfill({status:200,json:{saved:{id:body.id,label:body.label,revision:body.revision+1}}});
  });
  await page.setViewportSize({width:393,height:660});
  await page.getByRole('button',{name:'Save and next',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('[data-sample-id]')?.getAttribute('data-sample-id')!==id,before);
  assert.equal(await page.getByRole('button',{name:'Save and next',exact:true}).isDisabled(),true,'New sample must not inherit the old label');
  await page.waitForFunction(()=>document.querySelector('img[alt="Frame to label"]')?.naturalWidth>0);
  assert.equal(await page.evaluate(()=>{const r=document.querySelector('img[alt="Frame to label"]')?.getBoundingClientRect();return !!r && r.top>=0 && r.bottom<=innerHeight;}),true,'Saving from below the fold must bring the next frame into view');
  for (const [name,width,height] of [['desktop',1440,1000],['mobile',393,660]]) {
    await page.setViewportSize({width,height});
    await page.waitForFunction(()=>document.querySelector('img[alt="Frame to label"]')?.naturalWidth>0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`/Users/adil/ponglens-data/active-ball/review-v2-${name}.png`,fullPage:true});
  }
  console.log('PASS: replay, exact still, failed-save retention, save-and-next, fresh label, desktop/mobile overflow. No labels written.');
  await browser.close();
} catch(error) {
  if(browser)await browser.close();
  console.error('Review QA failed:',error.name, error.code ?? '', error.name==='AssertionError'?error.message:'');
  process.exitCode=1;
}
