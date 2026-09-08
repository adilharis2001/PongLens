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
  await page.getByRole('heading',{name:'Your label and Gemini'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save and next',exact:true}).count(),0,'Comparison must not edit reference labels');
  const image=page.getByAltText('Frame to label');
  await page.waitForFunction(()=>document.querySelector('img[alt="Frame to label"]')?.naturalWidth>0);
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/research/active-ball'))writes++;});
  await image.click({position:{x:120,y:90}});await page.keyboard.press('Enter');
  assert.equal(writes,0,'Comparison click/Enter must not save');
  const first=await page.locator('[data-sample-id]').getAttribute('data-sample-id');
  await page.getByRole('button',{name:'Next example →',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('[data-sample-id]')?.getAttribute('data-sample-id')!==id,first);
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',393,660]]) {
    await page.setViewportSize({width,height});
    await page.waitForFunction(()=>document.querySelector('img[alt="Frame to label"]')?.naturalWidth>0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`/Users/adil/ponglens-data/active-ball/gemini-comparison-${name}.png`,fullPage:true});
  }
  await page.getByLabel('View',{exact:true}).selectOption('labels');
  await page.getByRole('heading',{name:'Where is the active ball?'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save and next',exact:true}).count(),1,'Label editing should remain available separately');
  console.log('PASS: comparison is read-only, next disagreement, desktop/mobile rendering, separate label editor. No labels written.');
  await browser.close();
} catch(error) {
  if(browser)await browser.close();
  console.error('Review QA failed:',error.name, error.code ?? '', error.name==='AssertionError'?error.message:'');
  process.exitCode=1;
}
