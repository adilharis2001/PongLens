// Local component smoke test. Mounts the real components in a temporary route
// and removes that generated route afterward. No production writes:
// Supabase and application mutations are intercepted at the network boundary.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";

const base = process.env.QA_BASE_URL || "http://localhost:3012";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error("Local QA only");
const fixture = new URL("./fixtures/allowance-recovery-page.tsx", import.meta.url);
const routeDirectory = new URL("../../src/app/qa-allowance/", import.meta.url);
const routeFile = new URL("page.tsx", routeDirectory);
await mkdir(routeDirectory, { recursive: true });
await copyFile(fixture, routeFile, constants.COPYFILE_EXCL);
const browser = await chromium.launch({ headless: true });
try {
  // Next's file watcher may still be rebuilding its route map after mounting
  // the fixture. Wait for that observable condition, not an arbitrary delay.
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch(`${base}/qa-allowance`).catch(() => null);
    if (response?.status === 200) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "local fixture route is ready");
  for (const viewport of [{ width: 393, height: 660 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let purchases = false, pending = false, failSend = false, sends = 0, failConfig = false, imported = false, importCalls = 0, processCalls = 0, uploadCalls = 0, minutes = 0;
    const id = "11111111-1111-4111-8111-111111111111";
    await context.addInitScript(({ id }) => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: id, exp, aud: "authenticated" }))}.test`;
      const user = { id, aud: "authenticated", email: "qa@example.com", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      const session = { access_token: token, refresh_token: "qa-only", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
      document.cookie = `sb-pdycinmyfnritemrsfjf-auth-token=base64-${btoa(JSON.stringify(session))}; Path=/; SameSite=Lax`;
    }, { id });
    await context.route("https://*.supabase.co/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/user")) return route.fulfill({ json: { id, aud: "authenticated", email: "qa@example.com", app_metadata: {}, user_metadata: {} } });
      if (url.pathname.endsWith("/app_config")) return route.fulfill({ status: failConfig ? 503 : 200, json: failConfig ? { message: "offline" } : { value: String(purchases) } });
      if (url.pathname.endsWith("/quota_requests")) return route.fulfill({ json: pending ? [{ id: "request" }] : [] });
      if (url.pathname.endsWith("/matches")) return route.fulfill({ json: url.searchParams.has("job_id") ? null : url.searchParams.get("select")?.includes("duration_s") ? { id, status: "uploaded", duration_s: 600 } : [] });
      if (url.pathname.endsWith("/jobs")) return route.fulfill({ json: url.searchParams.get("select") === "id" ? [] : { status: imported ? "done" : "queued", progress: 100, options: { auto_process: true }, user_message: null, result_path: "r2://ponglens-raw/qa-video.mp4" } });
      if (url.pathname.endsWith("/rpc/my_processing_state")) return route.fulfill({ json: { minutes_balance: minutes } });
      if (url.pathname.endsWith("/rpc/my_storage_state")) return route.fulfill({ json: { used_bytes: 1000, storage_limit_bytes: 1000 } });
      throw Error(`Unexpected Supabase call: ${url.pathname}`);
    });
    await context.route(`${base}/api/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/upload-url") { uploadCalls++; return route.fulfill({ status: 429, json: { error: "Storage is full. Delete a video or manage your allowance in Account." } }); }
      if (path === "/api/import-url") { importCalls++; imported = true; return route.fulfill({ json: { ok: true, jobId: id, options: { auto_process: true } } }); }
      if (path === "/api/process") {
        processCalls++; assert.equal(route.request().postDataJSON().matchId, id);
        minutes = 100;
        return route.fulfill({ status: processCalls === 1 ? 409 : 200, json: processCalls === 1 ? { code: "queue_full" } : { job_id: id } });
      }
      assert.equal(path, "/api/allowances/request");
      const body = route.request().postDataJSON();
      assert.ok(["storage", "minutes"].includes(body.resource));
      assert.equal(body.message, "Tournament this weekend");
      sends++;
      if (!failSend) pending = true;
      await route.fulfill({ status: failSend ? 500 : 200, json: failSend ? { code: "server_error" } : { id: "request" } });
    });
    await page.goto(`${base}/qa-allowance`);
    await page.getByRole("button", { name: "Request more storage", exact: true }).click();
    const textarea = page.getByRole("textbox", { name: /Anything/ });
    await textarea.fill("Tournament this weekend");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    assert.equal(await textarea.inputValue(), "Tournament this weekend", "focus refresh must not discard draft");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(sends, 0);
    await page.getByRole("button", { name: "Request more storage", exact: true }).click();
    assert.equal(await textarea.inputValue(), "Tournament this weekend");
    failSend = true;
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await textarea.inputValue(), "Tournament this weekend", "failed send preserves message");
    failSend = false;
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await page.getByText("Request sent. We will notify you when it has been reviewed.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Request more storage", exact: true }).count(), 0);
    assert.equal(await page.getByRole("textbox", { name: "Opponent", exact: true }).inputValue(), "Alex");
    assert.ok(page.url().endsWith("/qa-allowance"));
    await page.getByRole("button", { name: "Try upload again", exact: true }).click();
    await page.getByText("Attempts: 1", { exact: true }).waitFor();
    assert.equal(sends, 2, "retry checks allowance but does not send another request");
    await page.screenshot({ path: `/tmp/ponglens-allowance-pending-${viewport.width}.png`, fullPage: true });
    pending = false;
    await page.getByRole("button", { name: "Minute limit", exact: true }).click();
    await page.getByRole("button", { name: "Request more minutes", exact: true }).waitFor();
    purchases = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("link", { name: "Get more minutes", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Request more minutes", exact: true }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "Get more minutes", exact: true }).getAttribute("href"), "/account#minutes");
    failConfig = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("alert").waitFor();
    await page.getByRole("link", { name: /Get more/ }).waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("link", { name: /Get more/ }).count(), 0, "failed refresh must clear stale purchase mode");
    await page.reload();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("link", { name: /Get more/ }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /Request more/ }).count(), 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    failConfig = false; purchases = false; pending = false;
    await page.getByRole("button", { name: "Show import", exact: true }).click();
    await page.getByPlaceholder(/YouTube|youtube/i).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByRole("button", { name: "Request more minutes", exact: true }).click();
    await page.getByRole("textbox", { name: /Anything/ }).fill("Tournament this weekend");
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await page.getByText("Request sent. We will notify you when it has been reviewed.", { exact: true }).waitFor();
    const processingResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/process");
    await page.getByRole("button", { name: "Try processing again", exact: true }).click();
    await processingResponse;
    await page.getByText("Your queue is full. Wait for a video to finish, then try again.", { exact: true }).waitFor();
    const nextProcessingResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/process");
    await page.getByRole("button", { name: "Try processing again", exact: true }).click();
    await nextProcessingResponse;
    await page.getByRole("button", { name: "Try processing again", exact: true }).waitFor({ state: "hidden" });
    assert.equal(importCalls, 1, "minute recovery must not download the video twice");
    assert.equal(processCalls, 2, "a full queue remains retryable after minutes were granted");
    pending = false;
    await page.getByRole("button", { name: "Show upload", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles(process.env.QA_VIDEO || "/tmp/ponglens-allowance-fixture.mp4");
    await page.getByRole("button", { name: "Request more storage", exact: true }).click();
    await page.getByRole("textbox", { name: /Anything/ }).fill("Tournament this weekend");
    await page.screenshot({ path: `/tmp/ponglens-allowance-upload-${viewport.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await page.getByText("Request sent. We will notify you when it has been reviewed.", { exact: true }).waitFor();
    const beforeRetry = uploadCalls;
    const uploadResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/upload-url");
    await page.getByRole("button", { name: "Try upload again", exact: true }).click();
    await uploadResponse;
    assert.ok(uploadCalls > beforeRetry, "retry resubmits the retained file without asking for another selection");
    await context.close();
    console.log(`PASS ${viewport.width}x${viewport.height}: requests, drafts, pending, flag changes, lookup failure, retained upload retry, import path fallback, queue-full retry`);
  }
} finally {
  await browser.close();
  // Only remove the exact fixture this run created; preserve an unexpected edit.
  if (await readFile(routeFile, "utf8") === await readFile(fixture, "utf8")) await unlink(routeFile);
}
