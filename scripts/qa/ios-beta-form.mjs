import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3024";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseUrl)) {
  throw new Error("Local QA only");
}

const screenshots = await mkdtemp(join(tmpdir(), "ponglens-ios-beta-form-"));
const browser = await chromium.launch({ headless: true });

async function assertMobileAction(page, name) {
  const metrics = await page.getByRole("button", { name, exact: true }).evaluate((button) => ({
    width: button.getBoundingClientRect().width,
    parentWidth: button.parentElement.getBoundingClientRect().width,
    height: button.getBoundingClientRect().height,
  }));
  assert.ok(Math.abs(metrics.width - metrics.parentWidth) < 2, `${name} fills the mobile action row`);
  assert.ok(metrics.height >= 44, `${name} is at least 44px high`);
}

try {
  const context = await browser.newContext({ viewport: { width: 393, height: 660 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  let outcome = "failure";
  let releasePending;
  const pendingGate = new Promise((resolve) => { releasePending = resolve; });
  const payloads = [];
  await context.route(`${baseUrl}/api/ios-beta`, async (route) => {
    payloads.push(route.request().postDataJSON());
    if (outcome === "failure") {
      await route.abort("internetdisconnected");
      return;
    }
    if (outcome === "pending") {
      await pendingGate;
    }
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const heroTrigger = page.getByRole("button", { name: "Get the iPhone beta", exact: true });
  await heroTrigger.click();
  await page.getByRole("dialog", { name: "Join the iPhone beta" }).waitFor();
  await page.getByRole("button", { name: "Close iPhone beta signup" }).click();
  assert.equal(await heroTrigger.evaluate((element) => document.activeElement === element), true, "closing returns focus to the hero trigger");
  const platformTrigger = page.getByRole("button", { name: /Get access/ });
  await platformTrigger.click();

  const dialog = page.getByRole("dialog", { name: "Join the iPhone beta" });
  await dialog.getByRole("button", { name: "Request beta access", exact: true }).click();
  assert.equal(await dialog.getByRole("textbox", { name: "Email", exact: true }).evaluate((element) => document.activeElement === element), true, "the required email receives focus");
  assert.equal(payloads.length, 0, "local validation prevents an incomplete request");
  await dialog.getByRole("textbox", { name: "Email", exact: true }).fill("player@example.com");
  await dialog.getByRole("button", { name: "Request beta access", exact: true }).click();
  await dialog.getByText("Choose Player, Coach, or Both.", { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("value") === "player");

  await dialog.getByRole("radio", { name: "Player", exact: true }).check();
  await dialog.getByRole("button", { name: "Request beta access", exact: true }).click();
  await dialog.getByText("Select at least one feature.", { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("value") === "iphone_recording");

  await dialog.getByRole("checkbox", { name: "Recording matches on my iPhone", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "Email", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "Not right now", exact: true }).check();
  assert.equal(await dialog.getByRole("checkbox", { name: "Email", exact: true }).isChecked(), false);
  await dialog.getByRole("checkbox", { name: "Audio call", exact: true }).check();
  assert.equal(await dialog.getByRole("checkbox", { name: "Not right now", exact: true }).isChecked(), false);

  await dialog.getByRole("radio", { name: "Coach", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "Building a coach profile players can find and share", exact: true }).check();
  assert.equal(await dialog.getByRole("checkbox", { name: "Recording matches on my iPhone", exact: true }).count(), 0);
  await dialog.getByRole("radio", { name: "Both", exact: true }).check();
  assert.equal(await dialog.getByRole("checkbox", { name: "Recording matches on my iPhone", exact: true }).count(), 1);
  assert.equal(await dialog.getByRole("checkbox", { name: "Building a coach profile players can find and share", exact: true }).count(), 1);
  await dialog.getByRole("radio", { name: "Coach", exact: true }).check();

  await assertMobileAction(dialog, "Request beta access");
  await assertMobileAction(dialog, "Cancel");
  await page.screenshot({ path: join(screenshots, "mobile-form.png"), fullPage: true });

  await dialog.getByRole("button", { name: "Request beta access", exact: true }).click();
  await dialog.getByText("We couldn’t confirm your invitation schedule. Please try again.", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("textbox", { name: "Email", exact: true }).inputValue(), "player@example.com");
  assert.equal(await dialog.getByRole("radio", { name: "Coach", exact: true }).isChecked(), true);
  assert.equal(await dialog.getByRole("checkbox", { name: "Building a coach profile players can find and share", exact: true }).isChecked(), true);
  assert.equal(await dialog.getByRole("checkbox", { name: "Audio call", exact: true }).isChecked(), true);

  outcome = "success";
  await dialog.getByRole("button", { name: "Request beta access", exact: true }).click();
  const successDialog = page.getByRole("dialog", { name: "Request received." });
  const successHeading = successDialog.getByRole("heading", { name: "Request received." });
  await successHeading.waitFor();
  assert.equal(await successHeading.evaluate((element) => document.activeElement === element), true, "confirmation receives keyboard focus");
  await assertMobileAction(successDialog, "Done");
  assert.equal(await successDialog.getByText("player@example.com", { exact: true }).count(), 1);
  assert.deepEqual(payloads.at(-1), {
    email: "player@example.com",
    company: "",
    answers: {
      formVersion: 2,
      role: "coach",
      interests: ["coach_profile"],
      feedback: ["audio_call"],
    },
  });
  await page.screenshot({ path: join(screenshots, "mobile-success.png"), fullPage: true });

  await successDialog.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(await platformTrigger.evaluate((element) => document.activeElement === element), true, "Done returns focus to the platform trigger");
  await page.getByRole("button", { name: "Get the iPhone beta", exact: true }).click();
  const staleDialog = page.getByRole("dialog", { name: "Join the iPhone beta" });
  await staleDialog.getByRole("textbox", { name: "Email", exact: true }).fill("stale@example.com");
  await staleDialog.getByRole("radio", { name: "Player", exact: true }).check();
  await staleDialog.getByRole("checkbox", { name: "Recording matches on my iPhone", exact: true }).check();
  outcome = "pending";
  const staleRequest = page.waitForRequest((request) => request.url() === `${baseUrl}/api/ios-beta`);
  await staleDialog.getByRole("button", { name: "Request beta access", exact: true }).click();
  await staleRequest;
  await staleDialog.getByRole("button", { name: "Sending request…", exact: true }).waitFor();
  assert.equal(await staleDialog.getByRole("textbox", { name: "Email", exact: true }).isDisabled(), true, "email cannot change during submission");
  assert.equal(await staleDialog.getByRole("radio", { name: "Player", exact: true }).isDisabled(), true, "role cannot change during submission");
  assert.equal(await staleDialog.getByRole("checkbox", { name: "Recording matches on my iPhone", exact: true }).isDisabled(), true, "answers cannot change during submission");
  await staleDialog.getByRole("button", { name: "Close iPhone beta signup" }).click();
  const staleResponse = page.waitForResponse((response) => response.url() === `${baseUrl}/api/ios-beta`);
  releasePending();
  await staleResponse;
  await page.getByRole("button", { name: "Get the iPhone beta", exact: true }).click();
  const reopenedDialog = page.getByRole("dialog", { name: "Join the iPhone beta" });
  assert.equal(await reopenedDialog.getByRole("textbox", { name: "Email", exact: true }).inputValue(), "", "closing resets the form and ignores the old response");
  await reopenedDialog.getByRole("button", { name: "Close iPhone beta signup" }).click();
  await context.close();

  for (const viewport of [
    { width: 320, height: 660, screenshot: "narrow-form.png" },
    { width: 1440, height: 900, screenshot: "desktop-form.png" },
  ]) {
    const layoutContext = await browser.newContext({ viewport });
    const layoutPage = await layoutContext.newPage();
    await layoutPage.goto(baseUrl, { waitUntil: "networkidle" });
    await layoutPage.getByRole("button", { name: "Get the iPhone beta", exact: true }).click();
    await layoutPage.getByRole("textbox", { name: "Email", exact: true }).fill("layout@example.com");
    await layoutPage.getByRole("radio", { name: "Both", exact: true }).check();
    await layoutPage.screenshot({ path: join(screenshots, viewport.screenshot), fullPage: true });
    assert.equal(await layoutPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${viewport.width}px viewport has no horizontal overflow`);
    const bounds = await layoutPage.getByRole("dialog").evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
      viewport: innerHeight,
      scrollable: element.scrollHeight > element.clientHeight || Array.from(element.children).some((child) => child.scrollHeight > child.clientHeight),
    }));
    assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.viewport, `${viewport.width}px dialog stays inside the viewport`);
    assert.equal(bounds.scrollable, true, `${viewport.width}px long form scrolls inside the dialog`);
    await layoutContext.close();
  }

  console.log(`PASS: iPhone beta form interactions and layouts; screenshots: ${screenshots}`);
} finally {
  await browser.close();
}
