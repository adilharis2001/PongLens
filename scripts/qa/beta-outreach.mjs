// Local synthetic browser QA. Temporarily place the fixture from
// scripts/qa/fixtures/beta-outreach-page.tsx at src/app/qa-beta-outreach/page.tsx
// using apply_patch, then remove that route after this script finishes.
// Run only against the designated local dev server on 3024. This script never
// signs in; it intercepts every Supabase REST and beta-action request.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const output = process.env.BETA_QA_OUTPUT || "/tmp/ponglens-beta-outreach-qa";
await mkdir(output, { recursive: true });
const id = "30000000-0000-0000-0000-000000000001";
const browser = await chromium.launch();
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 393, height: 660 },
  { width: 320, height: 660 },
]) {
  const page = await browser.newPage({ viewport });
  let beta = {
    id,
    email: "player@club.org",
    created_at: new Date().toISOString(),
    role: "player",
    interests: ["iphone_recording", "placement_maps"],
    feedback_choice: "opted_in",
    feedback_channels: ["audio_call"],
    scheduled_at: new Date(Date.now() + 82800000).toISOString(),
    delivery_state: "scheduled",
    delivery_error_code: null,
    early_send_requested_at: null,
    status: "new",
    follow_up_on: null,
  };
  const touches = [];
  let failSend = false;
  let failRefresh = false;
  await page.route("**/rest/v1/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    let data = [];
    if (name === "admin_beta_outreach_roster") data = [beta];
    if (name === "admin_outreach_touches") data = touches;
    if (name === "admin_outreach_act") {
      const body = route.request().postDataJSON();
      if (body.p_action === "touch")
        touches.push({
          id: "touch1",
          user_id: null,
          person_id: null,
          beta_request_id: id,
          kind: body.p_value,
          channel: body.p_channel,
          body: body.p_body,
          author: "Anton",
          at: new Date().toISOString(),
        });
    }
    if (name === "admin_beta_feedback_correct") {
      const body = route.request().postDataJSON();
      beta = {
        ...beta,
        role: body.p_role,
        interests: body.p_interests,
        feedback_choice: body.p_choice,
        feedback_channels: body.p_channels,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.route("**/api/admin/ios-beta/**", async (route) => {
    if (route.request().url().endsWith("/send")) {
      if (failSend)
        await route.fulfill({
          status: 503,
          json: { ok: false, status: "unknown" },
        });
      else {
        beta = { ...beta, delivery_state: "sending" };
        await route.fulfill({
          status: 200,
          json: { ok: true, status: "sending" },
        });
      }
    } else
      await route.fulfill({
        status: 200,
        json: {
          ok: !failRefresh,
          results: [
            { id, status: failRefresh ? "unknown" : beta.delivery_state },
          ],
        },
      });
  });
  await page.goto("http://127.0.0.1:3024/qa-beta-outreach");
  await page
    .getByRole("button", { name: "iPhone beta", exact: true })
    .click({ timeout: 7000 });
  await page.screenshot({ path: `${output}/${viewport.width}-overview.png` });
  if (viewport.width < 640) {
    await page.getByRole("button", { name: "Filters", exact: true }).click();
  }
  await page.getByLabel("Filter role").selectOption("coach");
  await page.getByText("No matching people.").waitFor();
  await page.getByLabel("Filter role").selectOption("player");
  await page.getByLabel("Filter interest").selectOption("placement_maps");
  await page.getByLabel("Filter contact method").selectOption("audio_call");
  await page.getByLabel("Filter invitation").selectOption("scheduled");
  await page
    .getByRole("button", { name: /player@club.org/ })
    .last()
    .waitFor();
  await page.getByLabel("Filter invitation").selectOption("");
  await page.getByLabel("Filter contact method").selectOption("");
  if (viewport.width < 640) {
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    assert.equal(await page.getByLabel("Filter role").isVisible(), false);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    assert.equal(await page.getByLabel("Filter role").inputValue(), "player");
    assert.equal(
      await page.getByLabel("Filter interest").inputValue(),
      "placement_maps",
    );
    await page.getByRole("button", { name: "Filters", exact: true }).click();
  }
  await page
    .getByRole("button", { name: /player@club.org/ })
    .last()
    .click();
  await page
    .getByRole("heading", { name: "iPhone beta", exact: true })
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -80));
  await page.screenshot({ path: `${output}/${viewport.width}-beta-top.png` });
  failSend = true;
  await page
    .getByRole("button", { name: "Send invite now", exact: true })
    .click();
  await page
    .getByText(
      "The invitation status could not be confirmed. Refresh to check it.",
    )
    .waitFor();
  failSend = false;
  await page
    .getByRole("button", { name: "Send invite now", exact: true })
    .click();
  await page.getByText("Sending…", { exact: true }).first().waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("dd")].some(
      (e) => e.textContent === "Sending…",
    ),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Send invite now", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Sending…", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .locator("dd")
      .filter({ hasText: /^Sent$/ })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await page
    .getByPlaceholder("Anything worth remembering")
    .fill("Beta applicant note");
  await page
    .getByRole("button", { name: "Add to the log", exact: true })
    .click();
  await page.getByText("Beta applicant note", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Correct answers", exact: true })
    .click();
  await page
    .getByLabel("Verification note")
    .fill("Applicant confirmed by email");
  await page.getByLabel("Email", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await page.getByText("Audio call, Email", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Record withdrawal", exact: true })
    .click();
  await page.getByLabel("Withdrawal note").fill("Applicant asked by email");
  await page
    .getByRole("button", { name: "Save withdrawal", exact: true })
    .click();
  await page
    .getByText("No feedback contact requested", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("heading", { name: /To contact/ }).count(),
    0,
  );
  await page.screenshot({ path: `${output}/${viewport.width}-detail.png` });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  if (viewport.width < 640) {
    for (const name of ["Sending…", "Correct answers", "Add to the log"]) {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      assert.ok(
        box && box.height >= 44 && box.width >= viewport.width - 90,
        `${name} must fill mobile content with a 44px target`,
      );
    }
  }
  failRefresh = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByText(
      "Some invitation statuses could not be confirmed. Please refresh again.",
    )
    .waitFor();
  failRefresh = false;
  beta = {
    ...beta,
    delivery_state: "scheduled",
    scheduled_at: new Date(Date.now() - 60000).toISOString(),
  };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByText("iPhone beta · Needs attention", { exact: true })
    .first()
    .waitFor();
  if (viewport.width < 640)
    await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Filter invitation").selectOption("needs_attention");
  assert.ok(
    (await page.getByRole("button", { name: /player@club.org/ }).count()) > 0,
    "Needs attention includes an overdue Scheduled invitation",
  );
  beta = {
    ...beta,
    delivery_state: "unknown",
    scheduled_at: new Date(Date.now() + 1800000).toISOString(),
  };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).waitFor();
  assert.ok(
    (await page.getByRole("button", { name: /player@club.org/ }).count()) > 0,
    "Needs attention includes a near-deadline Unknown invitation",
  );
  if (viewport.width < 640)
    await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("heading", { name: /Pending invitations/ })
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -80));
  await page.screenshot({
    path: `${output}/${viewport.width}-needs-attention.png`,
  });
  await page.close();
}
await browser.close();
console.log(`PASS beta outreach desktop/mobile/narrow screenshots: ${output}`);
