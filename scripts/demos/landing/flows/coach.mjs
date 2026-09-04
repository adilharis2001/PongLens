/**
 * Coach landing video, shared by the desktop and mobile cuts.
 *
 * The first frame is the live staged roster. The remaining beats use real
 * product captures made by scripts/demos/shots.mjs and the iOS simulator.
 * Desktop and mobile have separate shot manifests: the wide cut stays in the
 * web workspace, while the phone cut may show the native lesson recorder.
 * Swapping already-decoded images inside a fixed overlay keeps loading and
 * browser chrome out of the finished take while preserving the exact app UI.
 */

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const COACH_ID = "07601580-0ce3-4a4f-82b0-10ea04cac180";

const rest = async (key, url) => {
  const res = await fetch(`${SUPABASE}/rest/v1/${url}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

/** Validate the fixed demo data without changing it. */
export async function stage(key) {
  const rows = await rest(
    key,
    `coach_students?coach_id=eq.${COACH_ID}&archived_at=is.null&select=id&limit=1`
  );
  if (!rows.length) throw new Error("coach roster is empty; run scripts/demos/stage_coach.sql");
  console.log("  coach roster ready");
}

export async function cleanup() {
  // Read-only take. Kept as an explicit hook so interrupted captures and
  // future edits cannot accidentally inherit the old order-rewind cleanup.
}

const attempt = async (label, fn) => {
  for (let tryNumber = 1; tryNumber <= 3; tryNumber += 1) {
    try {
      return await fn();
    } catch (error) {
      const message = String(error);
      const navigating = message.includes("Execution context was destroyed");
      if (navigating && tryNumber < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      console.log(`  ! ${label}: ${message.split("\n")[0]}`);
      return null;
    }
  }
};

/** Replace the current product frame only after the next image is decoded. */
const showShot = async (page, clock, base, { at, file, position = "center" }) => {
  await clock.until(at);
  await attempt(`show ${file}`, () =>
    page.evaluate(
      async ([src, objectPosition]) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        image.alt = "";
        image.style.cssText = [
          "width:100%",
          "height:100%",
          "object-fit:contain",
          `object-position:${objectPosition}`,
          "display:block",
          "animation:coachDrift 9s ease-in-out both",
        ].join(";");

        let frame = document.querySelector("#coach-video-frame");
        if (!frame) {
          frame = document.createElement("div");
          frame.id = "coach-video-frame";
          frame.style.cssText = [
            "position:fixed",
            "inset:0",
            "z-index:2147483647",
            "overflow:hidden",
            "background:#08090f",
          ].join(";");
          const style = document.createElement("style");
          style.textContent = "@keyframes coachDrift{from{transform:scale(1.005)}to{transform:scale(1.035)}}";
          document.head.append(style);
          document.body.append(frame);
        }
        frame.replaceChildren(image);
      },
      [`${base}/showcase/${file}.jpg`, position]
    )
  );
};

export const prepare = async (page) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "ponglens:gesture-hints",
        JSON.stringify({ shown: {}, done: { dtap: true, hold: true, score: true } })
      );
    } catch {}
  });
};

const SHOTS = {
  desktop: {
    profile: "coach-page-d",
    students: "coach-students-d",
    record: "coach-entry-compose-d",
    share: "coach-entry-shared-d",
    request: "coach-order-d",
    orders: "coach-queue-d",
    delivery: "coach-points-d",
    payout: "coach-payout-d",
  },
  mobile: {
    profile: "coach-page-m",
    students: "coach-students-m",
    record: "coach-record-m",
    share: "coach-entry-shared-m",
    request: "coach-order-m",
    orders: "coach-queue-m",
    delivery: "coach-review-m",
    payout: "coach-payout-m",
  },
};

export function makeFlow({ platform = "mobile" } = {}) {
  const shots = SHOTS[platform];
  if (!shots) throw new Error(`unknown coach video platform: ${platform}`);

  return async function flow(page, clock, { beat }) {
    const base = process.env.BASE ?? "https://www.ponglens.com";

    // Opening: the live roster is already loaded by the capture driver.
    await clock.until(beat("intro").end);

    // The public presence comes first, before the private student workspace.
    await showShot(page, clock, base, {
      at: beat("profile").start - 2.6,
      file: shots.profile,
    });
    await clock.until(beat("profile").end);

    await showShot(page, clock, base, {
      at: beat("students").start - 2.6,
      file: shots.students,
    });
    await clock.until(beat("students").end);

    // Native recorder on mobile; the web lesson composer on desktop.
    await showShot(page, clock, base, {
      at: beat("record").start - 2.6,
      file: shots.record,
    });
    await clock.until(beat("record").end);

    // The result in the student's journal, not the sharing controls.
    await showShot(page, clock, base, {
      at: beat("share").start - 2.6,
      file: shots.share,
    });
    await clock.until(beat("share").end);

    // Incoming review requests and the queue are separate views of one area.
    await showShot(page, clock, base, {
      at: beat("request").start - 2.6,
      file: shots.request,
    });
    await clock.until(beat("request").end);
    await showShot(page, clock, base, {
      at: beat("orders").start - 0.5,
      file: shots.orders,
    });
    await clock.until(beat("orders").end);

    // Close the commercial workflow with the delivered review and payout.
    await showShot(page, clock, base, {
      at: beat("delivery").start - 2.6,
      file: shots.delivery,
    });
    await clock.until(beat("delivery").end);
    await showShot(page, clock, base, {
      at: beat("payout").start - 0.5,
      file: shots.payout,
    });
    await clock.until(beat("payout").end);
  };
}
