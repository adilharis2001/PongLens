// Synthetic data only. Use the local QA route documented in beta-outreach.mjs.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const output = "/tmp/ponglens-beta-identity-qa";
await mkdir(output, { recursive: true });
const email = "a-long-applicant-address-for-mobile@tabletennis-club.org";
const testEmail = "delivered+beta-receipt-test-20260906@resend.dev";
const hiddenEmail = "team-applicant@club.org";
const beta = { id: "b1", email, created_at: new Date().toISOString(), role: "player", interests: ["iphone_recording"], feedback_choice: "declined", feedback_channels: [], scheduled_at: new Date(Date.now()+82800000).toISOString(), delivery_state: "scheduled", delivery_error_code: null, early_send_requested_at: null, status: "new", follow_up_on: null };
const account = { user_id: "u1", email: hiddenEmail, name: "Team applicant", signed_up: new Date().toISOString(), last_seen: null, matches: 0, matches_scored: 0, matches_failed: 0, last_upload_at: null, points: 0, notes: 0, journal_entries: 0, share_links: 0, is_coach: false, kind: "team", status: "new", follow_up_on: null, hidden: true, last_outreach_at: null, last_feedback_at: null, touches: 0 };
const browser = await chromium.launch();
try {
for (const viewport of [{width:393,height:660},{width:320,height:660},{width:1440,height:900}]) {
 const page = await browser.newPage({viewport});
 await page.route("**/rest/v1/**", route => {
  const rpc = new URL(route.request().url()).pathname.split("/").pop();
  const data = rpc === "admin_outreach_roster" ? [account] : rpc === "admin_beta_outreach_roster" ? [beta,{...beta,id:"b2",email:testEmail},{...beta,id:"b3",email:hiddenEmail}] : [];
  return route.fulfill({status:200,json:data});
 });
 await page.route("**/api/admin/ios-beta/**", route => route.fulfill({status:200,json:{ok:true}}));
 await page.goto("http://127.0.0.1:3024/qa-beta-outreach");
 await page.getByRole("button",{name:"iPhone beta",exact:true}).click();
 const normalCard = page.getByRole("button",{name:new RegExp(email)}).first();
 await normalCard.waitFor();
 assert.equal(await page.getByRole("button",{name:new RegExp(testEmail.replaceAll("+","\\+"))}).count(),0,"Real must exclude synthetic beta signups");
 const pending = page.locator("section").filter({has:page.getByRole("heading",{name:/^Pending invitations/})});
 assert.equal(await pending.getByText(hiddenEmail,{exact:true}).count(),1,"Hidden Team beta request must remain actionable");
 await normalCard.scrollIntoViewIfNeeded();
 const title=normalCard.getByText(email,{exact:true});
 const layout=await title.evaluate(el=>({whiteSpace:getComputedStyle(el).whiteSpace,overflow:getComputedStyle(el).textOverflow,scroll:el.scrollWidth,width:el.clientWidth}));
 assert.notEqual(layout.whiteSpace,"nowrap","Email must wrap on mobile");
 assert.notEqual(layout.overflow,"ellipsis","Email must not be cut off");
 assert.ok(layout.scroll<=layout.width+1);
 await page.screenshot({path:`${output}/${viewport.width}-real.png`});
 await pending.getByRole("button",{name:new RegExp(hiddenEmail)}).click();
 await page.getByRole("link",{name:hiddenEmail,exact:true}).waitFor();
 for(const detail of await page.locator("dd").filter({hasText:hiddenEmail}).all()) {
  assert.notEqual(await detail.evaluate(el=>getComputedStyle(el).textOverflow),"ellipsis","Expanded account email must also remain readable");
 }
 if(viewport.width<640) {
  const box=await page.getByRole("button",{name:"Send invite now",exact:true}).boundingBox();
  assert.ok(box.height>=44 && box.width>=viewport.width-90);
 }
 await page.getByRole("link",{name:hiddenEmail,exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`${output}/${viewport.width}-hidden-detail.png`, animations:"disabled"});
 await page.getByRole("button",{name:/^Test \d+/}).click();
 assert.ok(await page.getByText(testEmail,{exact:true}).count()>0);
 assert.equal(await page.getByText(email,{exact:true}).count(),0,"Test must exclude real applicants");
 assert.equal(await page.getByText(hiddenEmail,{exact:true}).count(),0,"Test must exclude team applicants");
 await page.getByText(testEmail,{exact:true}).first().scrollIntoViewIfNeeded();
 await page.screenshot({path:`${output}/${viewport.width}-test.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.close();
}
console.log(`PASS beta identity, filtering, hidden invitations and mobile wrapping: ${output}`);
} finally {await browser.close();}
