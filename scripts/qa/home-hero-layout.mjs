import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.PONGLENS_BASE_URL ?? "http://127.0.0.1:4010";

async function actionMetrics(page) {
  const hero = page.locator("main > section").first();
  const actions = hero.locator("a:visible, button:visible");
  await assert.doesNotReject(() => actions.nth(1).waitFor());
  assert.equal(await actions.count(), 2, "the hero should have two actions");

  const primary = actions.nth(0);
  const secondary = actions.nth(1);
  const [primaryBox, secondaryBox] = await Promise.all([
    primary.boundingBox(),
    secondary.boundingBox(),
  ]);
  assert.ok(primaryBox && secondaryBox, "both hero actions should be visible");

  return { hero, primary, secondary, primaryBox, secondaryBox };
}

const browser = await chromium.launch({ headless: true });

try {
  const mobile = await browser.newPage({ viewport: { width: 393, height: 660 } });
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });

  const mobileActions = await actionMetrics(mobile);
  assert.equal(
    await mobileActions.primary.textContent(),
    "Upload your first match",
    "the primary action should name the upload that starts the flow",
  );
  assert.equal(
    await mobileActions.secondary.textContent(),
    "Get the iPhone beta",
    "the secondary action should be one direct line of copy",
  );
  assert.ok(
    Math.abs(mobileActions.primaryBox.width - mobileActions.secondaryBox.width) <= 1,
    "mobile hero actions should have the same width",
  );
  assert.ok(
    Math.abs(mobileActions.primaryBox.width - 320) <= 1,
    `mobile hero actions should be 320px wide; found ${mobileActions.primaryBox.width}px`,
  );
  assert.ok(
    Math.abs(mobileActions.primaryBox.height - mobileActions.secondaryBox.height) <= 1,
    "mobile hero actions should have the same height",
  );
  assert.ok(
    Math.abs(mobileActions.primaryBox.height - 56) <= 1,
    `mobile hero actions should be 56px high; found ${mobileActions.primaryBox.height}px`,
  );
  const secondaryLineCount = await mobileActions.secondary.locator("span").evaluate((label) => {
    const range = document.createRange();
    range.selectNodeContents(label);
    return range.getClientRects().length;
  });
  assert.equal(secondaryLineCount, 1, "the iPhone beta action should stay on one line");

  const tableSlab = mobileActions.hero.locator("[data-hero-table-slab]");
  assert.equal(await tableSlab.count(), 1, "the hero table slab should have one stable marker");
  const tableTop = await tableSlab.boundingBox();
  assert.ok(tableTop, "the mobile table illustration should be visible");
  const actionBottom = Math.max(
    mobileActions.primaryBox.y + mobileActions.primaryBox.height,
    mobileActions.secondaryBox.y + mobileActions.secondaryBox.height,
  );
  assert.ok(
    tableTop.y - actionBottom >= 72,
    `the table should begin at least 72px below the actions; found ${Math.round(tableTop.y - actionBottom)}px`,
  );

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(baseUrl, { waitUntil: "networkidle" });

  const desktopActions = await actionMetrics(desktop);
  assert.ok(
    Math.abs(desktopActions.primaryBox.height - desktopActions.secondaryBox.height) <= 1,
    "desktop hero actions should have the same height",
  );
  assert.ok(
    Math.abs(desktopActions.primaryBox.y - desktopActions.secondaryBox.y) <= 1,
    "desktop hero actions should share one baseline",
  );

  const visualStyle = (action) => action.evaluate((element) => {
    const style = getComputedStyle(element);
    const channels = (color) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    return {
      backgroundChannels: channels(style.backgroundColor),
      borderChannels: channels(style.borderTopColor),
      textChannels: channels(style.color),
    };
  });
  const [primaryStyle, secondaryStyle] = await Promise.all([
    visualStyle(desktopActions.primary),
    visualStyle(desktopActions.secondary),
  ]);
  assert.ok(
    primaryStyle.backgroundChannels
      .slice(0, 3)
      .every((channel, index) => Math.abs(channel - secondaryStyle.textChannels[index]) <= 1),
    "the primary fill should use the same PongLens cyan as the secondary action",
  );
  assert.ok(
    primaryStyle.backgroundChannels[3] >= 250 && secondaryStyle.backgroundChannels[3] <= 64,
    "the primary should be filled while the secondary stays lightly tinted",
  );
  assert.ok(
    secondaryStyle.backgroundChannels
      .slice(0, 3)
      .every((channel, index) => Math.abs(channel - secondaryStyle.textChannels[index]) <= 8) &&
      secondaryStyle.backgroundChannels[3] > 0,
    "the secondary background should be a translucent PongLens cyan",
  );
  assert.ok(
    secondaryStyle.borderChannels
      .slice(0, 3)
      .every((channel, index) => Math.abs(channel - secondaryStyle.textChannels[index]) <= 1),
    "the secondary action should use the PongLens cyan border",
  );
  assert.ok(
    secondaryStyle.borderChannels[3] >= 64,
    "the outlined secondary action should keep a visible border",
  );
} finally {
  await browser.close();
}
