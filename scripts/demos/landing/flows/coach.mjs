/**
 * The coach video's shot list, shared by both cuts.
 *
 * One continuous take timed to voice/coach.json. Every rule here was paid
 * for by the landing cut; see SCRIPT-COACH.md and the commit history on
 * shared.mjs rather than rediscovering them.
 *
 * THE RULE: the voice says the outcome, the picture proves the mechanic.
 * The narration never says "press the microphone" — it says you can speak
 * instead of typing, and the picture has the microphone in it.
 *
 * Navigations fire in the gaps BETWEEN lines. A page load is about a
 * second of dark frame: under a sentence that reads as broken, in a gap it
 * reads as an edit. Scrolls are instant jumps for the same reason a cut is
 * a cut — a visible scroll is the thing that looked cheap.
 *
 * Shot from the staged coach (scripts/demos/stage_coach.sql):
 *
 *   Miguel Santos  07601580  handle `miguel`, 3 offerings, 4 orders
 *   ORDER_ACTIVE   0a5e0002…0001  John Miller, the Alex match, 3 findings
 *   ORDER_DONE     0a5e0002…0002  completed, so it reads as delivered
 *
 * ORDER_ACTIVE is pushed back to `submitted` by stage() so the video can
 * accept it on camera, and put back in cleanup(). Nothing else is written.
 */

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";

export const COACH_HANDLE = "miguel";
export const ORDER_ACTIVE = "0a5e0002-0000-4000-8000-000000000001";
export const ORDER_DONE = "0a5e0002-0000-4000-8000-000000000002";

const rest = async (key, url, init = {}) => {
  const res = await fetch(`${SUPABASE}/rest/v1/${url}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

/**
 * Hand the order back to the "new order" state so the accept can be filmed.
 *
 * The landing cut learned this the expensive way: a beat that films found
 * data is one cleanup away from filming a 404. This does not create an
 * order, it rewinds one — which keeps the student, the match and the three
 * findings that the later beats need, so the whole video is one story
 * about one order rather than two unrelated ones.
 */
export async function stage(key) {
  const [before] = await rest(
    key,
    `review_orders?id=eq.${ORDER_ACTIVE}&select=status,accepted_at,promised_by`
  );
  if (!before) throw new Error(`order ${ORDER_ACTIVE} is missing; run stage_coach.sql`);
  await rest(key, `review_orders?id=eq.${ORDER_ACTIVE}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "submitted",
      accepted_at: null,
      promised_by: null,
    }),
  });
  stage.before = before;
  console.log(`  rewound ${ORDER_ACTIVE.slice(0, 8)} to submitted`);
}

export async function cleanup(key) {
  const before = stage.before ?? {
    status: "in_review",
    accepted_at: "2026-08-04T19:40:00+00:00",
    promised_by: "2026-08-09T18:00:00+00:00",
  };
  await rest(key, `review_orders?id=eq.${ORDER_ACTIVE}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(before),
  });
  console.log(`  put ${ORDER_ACTIVE.slice(0, 8)} back to ${before.status}`);
}

/** Never let one bad selector take the rest of the take with it. */
const attempt = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.log(`  ! ${label}: ${String(err).split("\n")[0]}`);
  }
};

const go = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
};

/**
 * Put something on screen, instantly.
 *
 * Instant, not smooth: a smooth scroll to something far down the page
 * takes longer than the window it was given, and clock.until cannot
 * rewind, so one late beat makes every later beat late. Scrolls twice with
 * a beat between, because hydration restores scrollTop and undoes the
 * first one.
 */
const bring = async (page, clock, text, block = "center") => {
  await attempt(`bring ${text}`, async () => {
    const apply = () =>
      page.evaluate(
        ([t, b]) => {
          const el = [...document.querySelectorAll("h1,h2,h3,p,label,span")].find(
            (h) => h.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
          );
          if (!el) return false;
          el.scrollIntoView({ block: b, behavior: "instant" });
          return true;
        },
        [text, block]
      );
    if (!(await apply())) throw new Error("no element matched");
    await clock.sleep(220);
    await apply();
    await clock.sleep(120);
  });
};

/**
 * Highlight for the length of a beat. Big mid-screen blocks only: a small
 * box tucks its own label chip inside itself and covers what it points at,
 * and a ring that lasts under a second reads as a glitch.
 */
const spot = async (page, clock, { label, spec, until, min = 40 }) => {
  let entry = null;
  await attempt(`spot ${label}`, async () => {
    const rect = await clock.rect(spec);
    if (!rect || rect.w < min || rect.h < min) {
      throw new Error("rect too small to box");
    }
    entry = clock.mark({ kind: "box", label, rect });
  });
  await clock.until(until);
  if (entry) clock.close(entry);
};

export const prepare = async (page) => {
  // A capture runs in a fresh profile, so every first-run gesture hint
  // floats over the picture unless it is marked as already seen.
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
  return async function flow(page, clock, { beat, dismiss }) {
    const base = process.env.BASE ?? "https://www.ponglens.com";

    // ------------------------------------------------ 1. what this is
    // Named over a coach's own page, with real prices on it. The product
    // is not a menu and the first frame is the most valuable one we own.
    await bring(page, clock, layout.introAnchor, "start");
    await clock.until(beat("intro").end + 0.3);

    // ------------------------------------------------ 2. what you sell
    await go(page, `${base}/coaching/offerings`);
    await attempt("open the offering", () =>
      page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim().startsWith("Full match review"))
          ?.click();
      })
    );
    await clock.sleep(500);
    // The price row and the fee line under it. No ring: "Price" is a
    // <label>, not a heading, so there is no section to box, and the
    // editor reads as a whole anyway. Screens that read as a whole get
    // nothing drawn on them.
    await bring(page, clock, "Price", "center");
    await clock.until(beat("offer").end);

    // ------------------------------------------------ 3. your page
    await clock.until(beat("offer").end + 0.2);
    await go(page, `${base}/coach/${COACH_HANDLE}`);
    // Whatever the intro beat did NOT show. At desktop width the storefront
    // is a sticky identity rail beside a content column, so both beats land
    // on the same picture unless they are aimed apart — nine seconds on one
    // static screen. The phone stacks the same content, so the pair is the
    // other way round there: prices first, then who the coach is.
    await bring(page, clock, layout.pageAnchor, layout.pageBlock ?? "center");
    await clock.until(beat("page").end);

    // ------------------------------------------------ 4. sending the link
    await go(page, `${base}/coaching`);
    await clock.until(beat("link").start - 0.6);
    await attempt("open the QR", () =>
      page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim() === "QR")
          ?.click();
      })
    );
    await clock.sleep(400);
    await clock.until(beat("link").end);

    // ------------------------------------------------ 5. payouts
    await attempt("close the QR", () =>
      page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim() === "QR")
          ?.click();
      })
    );
    await bring(page, clock, "Payouts", "center");
    await clock.until(beat("payouts").start - 0.2);
    await spot(page, clock, {
      label: "Stripe pays your bank",
      spec: { sectionOf: "Payouts" },
      until: beat("payouts").end,
    });

    // ------------------------------------------------ 6. the order arrives
    await clock.until(beat("payouts").end + 0.1);
    await go(page, `${base}/coaching/orders/${ORDER_ACTIVE}`);
    await bring(page, clock, "Their brief", "center");
    await clock.until(beat("order").start - 0.2);
    await spot(page, clock, {
      label: "What they asked for",
      spec: { sectionOf: "Their brief" },
      until: beat("order").end,
    });

    // ------------------------------------------------ 7. accept it
    // Clicked for real. The order was rewound to `submitted` by stage()
    // and is put back in the driver's finally.
    await bring(page, clock, "Accepting starts", "center");
    await clock.until(beat("accept").end - 1.8);
    await attempt("accept the order", () =>
      page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim().startsWith("Accept and start"))
          ?.click();
      })
    );
    await clock.until(beat("accept").end);

    // ------------------------------------------------ 8. what arrives
    // The workspace: the player with the point strip under it. Landing
    // measured, so the first frame that paints is already the shot.
    await go(page, `${base}/coaching/orders/${ORDER_ACTIVE}`);
    await bring(page, clock, "The points", "start");
    // The strip only fills in once the points arrive; ringing it before
    // that boxes an empty row.
    await attempt("wait for the score", () =>
      page.waitForFunction(
        () => {
          const el = [...document.querySelectorAll("p")].find((e) =>
            e.textContent.trim().startsWith("Point ")
          );
          return !!el && !el.textContent.includes("unscored");
        },
        { timeout: 6000 }
      )
    );
    await clock.until(beat("cut").end);

    // ------------------------------------------------ 9. doing the work
    // A rally actually running under the line about watching it.
    await attempt("play the clip", () =>
      page.evaluate(() => {
        const v = document.querySelector("video");
        if (v) void v.play();
      })
    );
    await clock.until(beat("work").end);

    // ------------------------------------------------ 10. attach the points
    await attempt("pause the clip", () =>
      page.evaluate(() => document.querySelectorAll("video").forEach((v) => v.pause()))
    );
    // Land on a point that is already in a pattern, so the sheet opens with
    // a tick in it rather than three empty circles, which is a picture of
    // the feature not being used.
    //
    // Picked by STYLE, not by number. Two goes at matching the label failed
    // for different reasons: the strip renders a star before the number, so
    // a linked point reads "★16" and never equals "16"; and there are other
    // buttons on the page whose whole text is a digit. The tagged chip has
    // its own border colour, which is the same property the beat is about,
    // so it cannot drift out of step with the data the way a number can.
    await attempt("select a linked point", () =>
      page.evaluate(() => {
        const chip = [...document.querySelectorAll("button")].find(
          (b) =>
            /^★?\d+$/.test(b.textContent.trim()) &&
            b.className.includes("border-cyan-glow/50")
        );
        if (!chip) throw new Error("no tagged chip on the strip");
        chip.click();
      })
    );
    await clock.sleep(400);
    await attempt("open the pattern sheet", () =>
      page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim().startsWith("Add to a pattern"))
          ?.click();
      })
    );
    await clock.sleep(500);
    await clock.until(beat("attach").end);
    // Out through dismiss(), which clicks the real control and then waits
    // for the node to detach rather than believing it closed. The gone-spec
    // is Cancel, which only exists inside the sheet — "Add to a pattern" is
    // also the button BEHIND it, so it would still match after closing and
    // the capture would fail believing the sheet was stuck.
    await attempt("close the pattern sheet", () =>
      dismiss(page, {
        click: { text: "Cancel", tag: "button" },
        gone: { text: "Cancel", tag: "button" },
      })
    );

    // ------------------------------------------------ 11. speaking it
    // The whole Summary block, not the microphone button: a 28px ring puts
    // its own label chip over the thing it is pointing at.
    await bring(page, clock, "Your write-up", "start");
    await clock.until(beat("voice").start - 0.2);
    await spot(page, clock, {
      label: "Speak it instead",
      spec: { sectionOf: "Your write-up" },
      until: beat("voice").end,
    });

    // ------------------------------------------------ 12. what they get
    // The completed order reads with the same component the student reads,
    // so this is honestly what lands in their account.
    await clock.until(beat("voice").end + 0.1);
    await go(page, `${base}/coaching/orders/${ORDER_DONE}`);
    await bring(page, clock, "Summary", "start");
    await clock.until(beat("deliver").start + 1.2);
    // Held still it reads as a screenshot of a page rather than something a
    // coach sat down and wrote. Animated inside the page by rAF: a loop of
    // evaluate calls lands every 40-60ms and stutters at exactly the rate
    // the capture records at.
    await attempt("scroll the review", () =>
      page.evaluate((dist) => {
        const t0 = performance.now();
        const from = window.scrollY;
        const step = (now) => {
          const k = Math.min(1, (now - t0) / 2600);
          window.scrollTo(0, from + dist * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, layout.reviewScroll)
    );
    await clock.until(beat("deliver").end);

    // ------------------------------------------------ 13. getting paid
    await go(page, `${base}/coaching`);
    await bring(page, clock, "earned", "center");
    await clock.until(beat("paid").end);

    // ------------------------------------------------ 14. close
    // The composition puts the logo on the end; this just holds a real
    // screen under the last line rather than a frozen half-scroll.
    await clock.until(beat("close").end);
  };
}
