// Exercise the shipped page, not a copy of its markup. Never submits a form.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.QA_BASE_URL ?? 'http://localhost:3024';
const out = process.env.QA_OUT ?? '/tmp/ponglens-coach-landing';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [viewport, reducedMotion] of [
    [{ width: 393, height: 660 }, 'reduce'],
    [{ width: 1440, height: 900 }, 'reduce'],
    [{ width: 320, height: 660 }, 'reduce'],
    [{ width: 393, height: 660 }, 'no-preference'],
    [{ width: 1440, height: 900 }, 'no-preference'],
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/coaches`, { waitUntil: 'networkidle' });
    const actions = page.locator('a[href="/coaching/start"]');
    assert.equal(await actions.count(), 2, 'hero and closing actions both start coaching');
    for (const action of await actions.all()) {
      const box = await action.boundingBox();
      assert.ok(box.height >= 44, 'start coaching touch target');
      if (viewport.width < 640) {
        assert.ok(Math.abs(box.width - (viewport.width - 48)) < 2, 'mobile primary actions fill the content width');
      }
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
    await page.screenshot({ path: `${out}/hero-${viewport.width}.png` });
    await page.locator('#features').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/features-${viewport.width}.png` });
    const band = page.locator('#steps');
    const controls = viewport.width >= 768 ? band.locator('ol button') : band.locator('button[aria-current]');
    // Mobile controls are the six numbered buttons, identified by their label.
    const names = ['Manage your students', 'Review shared matches', 'Record a lesson', 'Share lesson notes', 'Revisit a lesson on video', 'Offer paid match reviews'];
    if (viewport.width >= 768) assert.equal(await controls.count(), names.length);
    for (let index = 0; index < names.length; index++) {
      const control = viewport.width >= 768 ? controls.nth(index) : band.getByRole('button', { name: names[index], exact: true }).last();
      await control.click();
      await band.scrollIntoViewIfNeeded();
      const card = band.getByRole('button', { name: names[index], exact: true }).first();
      const images = card.locator('img');
      for (const image of await images.all()) {
        await image.evaluate(async img => { await img.decode(); });
        const size = await image.evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight }));
        assert.ok(size.width >= 780, 'retina screenshot');
        assert.ok(Math.abs(size.width / size.height - 390 / 844) < 0.002, 'player-side screenshot proportions');
      }
      await page.screenshot({ path: `${out}/chapter-${index + 1}-${viewport.width}.png`, animations: 'disabled' });
    }
    await page.locator('summary').filter({ hasText: 'Does it work on iPhone and the web?' }).click();
    const beta = page.getByRole('link', { name: 'Join the iPhone beta', exact: true });
    assert.equal(await beta.getAttribute('href'), '/#ios-beta');
    const response = await page.request.get(`${base}/`);
    assert.ok((await response.text()).includes('id="ios-beta"'), 'beta link lands at the existing signup form');
    await page.locator('#faq').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/faq-${viewport.width}.png` });
    assert.deepEqual(errors, [], 'no client exceptions');
    // The existing player feature animations have a separate reduced-motion
    // hydration warning, reproduced on production. Do not hide that warning or
    // count the player reduced-motion page as passing in this scoped release.
    if (reducedMotion === 'no-preference') {
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('#ios-beta').count(), 1, 'player beta anchor');
      assert.deepEqual(errors, [], 'player page has no client exceptions with normal motion');
    }
    console.log(`PASS coach ${viewport.width}×${viewport.height} (${reducedMotion}): actions, six chapters, images, FAQ signup link, no overflow or client errors`);
    await context.close();
  }
} finally {
  await browser.close();
}
