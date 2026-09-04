/**
 * Coach landing video, shared by the desktop and mobile cuts.
 *
 * The first frame is the live staged roster. The remaining beats use real
 * product captures made by scripts/demos/shots.mjs and the iOS simulator.
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
  try {
    return await fn();
  } catch (error) {
    console.log(`  ! ${label}: ${String(error).split("\n")[0]}`);
    return null;
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

export function makeFlow(layout) {
  return async function flow(page, clock, { beat }) {
    const base = process.env.BASE ?? "https://www.ponglens.com";

    // Opening and first feature: the live roster is already loaded by the
    // capture driver. No add-student or invite flow appears in this cut.
    await clock.until(beat("intro").end);
    await clock.until(beat("students").end);

    // Coaching journals: show the lasting record, not how to fill in a form.
    await showShot(page, clock, base, {
      at: beat("journal").start - 2.6,
      file: layout.journalShot,
    });
    await clock.until(beat("journal").end);

    // The real iPhone audio recorder. Video recording is described as coming
    // soon until that capture is available.
    await showShot(page, clock, base, {
      at: beat("record").start - 2.6,
      file: "coach-record-m",
    });
    await clock.until(beat("record").end);

    // The result in the student's journal, not the sharing controls.
    await showShot(page, clock, base, {
      at: beat("share").start - 2.6,
      file: "journal-m",
    });
    await clock.until(beat("share").end);

    // The student's history establishes the context before the match itself.
    await showShot(page, clock, base, {
      at: beat("context").start - 2.6,
      file: layout.contextShot,
    });
    await clock.until(beat("context").end);
    await showShot(page, clock, base, {
      at: beat("feedback").start - 0.5,
      file: "coach-points-m",
    });
    await clock.until(beat("feedback").end);

    // Paid reviews remain available, but they close the story rather than
    // defining the whole coach product.
    await showShot(page, clock, base, {
      at: beat("reviews").start - 2.6,
      file: "coach-offering-m",
    });
    await clock.until(beat("reviews").end);
  };
}
