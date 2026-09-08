import { coachAccount, student } from "../account.mjs";
import {
  hideCaptureTransition,
  showCaptureTransition,
  waitBeforeCaptureTransition,
} from "../../capture-transition.mjs";

export const account = coachAccount();
export const studentAccount = student();

export const COACH_ID = "07601580-0ce3-4a4f-82b0-10ea04cac180";
export const CONNECTED_STUDENT_ID = "0a5e0004-0000-4000-8000-000000000001";
export const OFFLINE_STUDENT_ID = "0a5e0004-0000-4000-8000-000000000002";
export const SHARED_MATCH_ID = "efff9208-abf2-4a20-a498-18cc5a5130b3";
export const REVIEW_ORDER_ID = "0a5e0002-0000-4000-8000-000000000001";

export const coachGuard = (tables) => ({
  kind: "coach",
  ownerId: COACH_ID,
  ownerEmail: account,
  marker: "Tutorial fixture",
  tables,
});

/** Prevent read-only tutorial captures from running Orders housekeeping.
 * The route is deliberately narrow: every request except POST sweep keeps
 * the shipping behavior, including ordinary reads and explicit actions.
 */
export async function blockReviewSweep(page) {
  await page.route("**/api/reviews/transition", async (route) => {
    const request = route.request();
    let action = null;
    if (request.method() === "POST") {
      try {
        action = request.postDataJSON()?.action ?? null;
      } catch {
        // Non-JSON requests are not the automatic sweep. The endpoint gets
        // to validate them normally.
      }
    }
    if (action === "sweep") {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

const origin = (page) => new URL(page.url()).origin;

/** A match route paints before its signed preview URL arrives. The play
 * affordance exists only after that URL has replaced "Loading preview…". */
export async function waitForMatchPreview(page) {
  // The button proves URL signing completed; the media predicate proves the
  // browser has replaced the placeholder with a real decoded poster frame.
  await page.waitForFunction(
    () => Boolean(document.querySelector('[aria-label="Play the full video"]')),
    undefined,
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () => {
      const video = [...document.querySelectorAll("video")].find(
        (candidate) => !candidate.closest('[role="dialog"]'),
      );
      return video && video.readyState >= 2 && video.videoWidth > 0;
    },
    undefined,
    { timeout: 30000 },
  );
}

async function hit(page, selector) {
  return page.evaluate((spec) => {
    const element = window.__pick(spec);
    element?.click();
    return Boolean(element);
  }, selector);
}

async function fill(page, selector, value) {
  const changed = await page.evaluate(
    ([spec, next]) => {
      const element = window.__pick(spec);
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        return false;
      }
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element),
        "value",
      )?.set;
      setter?.call(element, next);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    [selector, value],
  );
  if (!changed) throw new Error(`could not fill ${JSON.stringify(selector)}`);
}

async function select(page, selector, value) {
  const changed = await page.evaluate(
    ([spec, next]) => {
      const element = window.__pick(spec);
      if (!(element instanceof HTMLSelectElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(element, next);
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return element.value === next;
    },
    [selector, value],
  );
  if (!changed) throw new Error(`could not select ${JSON.stringify(selector)}`);
}

async function act(page, action) {
  if (!action) return;
  if (action.type === "click") {
    if (!(await hit(page, action.target))) {
      throw new Error(`could not click ${JSON.stringify(action.target)}`);
    }
    return;
  }
  if (action.type === "fill") {
    await fill(page, action.target, action.value);
    return;
  }
  if (action.type === "select") {
    await select(page, action.target, action.value);
    return;
  }
  throw new Error(`unknown coach tutorial action: ${action.type}`);
}

/**
 * One declarative coach-course scene. Selectors stay data so tests can prove
 * every annotation names a real accessible control or an explicitly scoped
 * element, while capture still drives the shipping page.
 */
export async function showScene(page, clock, scene, timing) {
  const covered = Boolean(scene.transition) || scene.route?.startsWith("/match/");
  if (covered) {
    await waitBeforeCaptureTransition(clock);
    await showCaptureTransition(page);
  }
  if (scene.route) {
    await page.goto(`${origin(page)}${scene.route}`);
    if (scene.route.startsWith("/match/")) {
      await waitForMatchPreview(page);
    }
  }
  if (scene.action) {
    await page.waitForFunction(
      (spec) => Boolean(window.__pick(spec)),
      scene.action.target,
      { timeout: 30000 },
    );
  }
  await act(page, scene.action);
  if (scene.waitFor) {
    await page.waitForFunction((spec) => Boolean(window.__pick(spec)), scene.waitFor, {
      timeout: 30000,
    });
  }
  if (scene.settle) await clock.sleep(scene.settle);

  // Several coach surfaces load their roster, recent entries, or a sheet
  // after the route itself is ready. Waiting for the thing we actually put
  // on camera prevents a fast capture from racing that product state.
  await page.waitForFunction((spec) => Boolean(window.__pick(spec)), scene.target, {
    timeout: 30000,
  });
  if (scene.secondaryTarget) {
    await page.waitForFunction(
      (spec) => Boolean(window.__pick(spec)),
      scene.secondaryTarget,
      { timeout: 30000 },
    );
  }
  if (scene.transition === "dialog-video") {
    await page.waitForFunction(
      () => {
        const video = document.querySelector('[role="dialog"] video');
        return video && video.readyState >= 2 && video.videoWidth > 0;
      },
      undefined,
      { timeout: 30000 },
    );
    // Put the narrated section in view before exposing the shipping page.
    await page.evaluate((spec) => {
      window.__pick(spec)?.scrollIntoView({ behavior: "auto", block: "center" });
    }, scene.target);
  }
  if (covered) await hideCaptureTransition(page);

  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const openCue = async (target, label) => {
    await page.evaluate((spec) => {
      window.__pick(spec)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, target);
    await clock.sleep(450);
    const rect = await clock.rect(target);
    const width = Math.min(viewport.width - 16, rect.w + 16);
    const height = Math.min(viewport.height - 72, rect.h + 16);
    return clock.mark({
      kind: "box",
      label,
      rect: {
        x: Math.max(8, Math.min(rect.x - 8, viewport.width - width - 8)),
        y: Math.max(64, Math.min(rect.y - 8, viewport.height - height - 8)),
        w: width,
        h: height,
      },
    });
  };

  await clock.until(timing.start + 0.12);
  const primary = await openCue(scene.target, scene.primaryLabel ?? scene.label);
  if (!scene.secondaryTarget) {
    await clock.until(timing.end);
    clock.close(primary);
    return;
  }

  const midpoint = timing.start + timing.dur * 0.5;
  await clock.until(midpoint);
  clock.close(primary);
  const secondary = await openCue(
    scene.secondaryTarget,
    scene.secondaryLabel ?? scene.label,
  );
  await clock.until(timing.end);
  clock.close(secondary);
}

export function makeRun(scenes) {
  return async function run(page, clock, helpers) {
    const renderScene = helpers.showScene ?? showScene;
    for (const scene of scenes) {
      const timing = helpers.beat(scene.beat);
      await renderScene(page, clock, scene, timing);
    }
    if (clock) await clock.until(helpers.voice.total + 0.4);
  };
}
