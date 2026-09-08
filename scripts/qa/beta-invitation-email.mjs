// Render the production email HTML without signing up or sending any email.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { betaInvitationPreviews } from "../email/beta-invitation-previews.ts";
import { betaInvitationEmail } from "../../src/lib/email/catalog.ts";
import { renderEmail } from "../../src/lib/email/render.ts";
import { PLAYER_INTERESTS, COACH_INTERESTS } from "../../src/lib/iosBeta/questionnaire.ts";

const output = "/tmp/ponglens-personalized-beta";
await mkdir(output,{recursive:true});
const previews = [...betaInvitationPreviews, {id:"all-features",...renderEmail(betaInvitationEmail("https://testflight.apple.com/join/H9XdnySg",{role:"both",interests:[...PLAYER_INTERESTS,...COACH_INTERESTS].map(o=>o.value)}))}];
const browser = await chromium.launch();
try {
 for (const preview of previews) {
  await writeFile(`${output}/${preview.id}.html`,preview.html);
  assert.ok(Buffer.byteLength(preview.html)<90000,"Keep the email below Gmail clipping size");
  for (const width of [393,320,1000]) for (const colorScheme of ["light","dark"]) {
   const page=await browser.newPage({viewport:{width,height:660},colorScheme});
   await page.setContent(preview.html,{waitUntil:"networkidle"});
   const action=page.getByRole("link",{name:"Install PongLens beta",exact:true});
   const box=await action.boundingBox();
   assert.ok(box && box.y+box.height<660 && box.height>=44,"Install action is in the opening viewport");
   if(width<=480) {
    const card=await page.locator(".email-card-cell").boundingBox();
    assert.ok(box.width>=card.width-49,"Action fills the mobile content width");
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.locator(".inset-card").count(),0,"Features are not nested cards");
   await page.screenshot({path:`${output}/${preview.id}-${width}-${colorScheme}.png`,fullPage:true});
   await page.close();
  }
 }
 // Progressive fallback: without style blocks or images it still has the
 // readable feature text and a functional installation link.
 const page=await browser.newPage({viewport:{width:393,height:660}});
 await page.setContent(betaInvitationPreviews[0].html.replace(/<style>[\s\S]*?<\/style>/g,"").replace(/<img\b[^>]*>/g,""));
 assert.equal(await page.getByRole("link",{name:"Install PongLens beta",exact:true}).count(),1);
 assert.ok((await page.locator("li").count())>=7);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`${output}/no-images-or-theme-css.png`,fullPage:true});
 await page.close();
 console.log(`PASS email QA: 24 responsive/theme renders and no-images/CSS fallback. ${output}`);
} finally {await browser.close();}
