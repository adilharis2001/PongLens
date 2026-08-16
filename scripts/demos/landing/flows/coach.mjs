/**
 * The coach video's shot list, shared by both cuts.
 *
 * One continuous take timed to voice/coach.json.
 *
 * THE RULE: the voice says the outcome, the picture proves the mechanic.
 *
 * TWO RULES ADDED AFTER THE FIRST CUT WAS WATCHED:
 *
 *  1. Nothing loads on camera. Every navigation happens a good two and a
 *     half seconds before its line, and the page is scrolled into position
 *     while it is still silent, so the frame the line opens on is already
 *     the shot. `arrive()` is the only way this flow changes page.
 *
 *     A THIRD RULE, ADDED AFTER THE LANDING CUT: at a section boundary,
 *     early is not enough — the navigation has to happen behind the section
 *     card. The composition covers the whole gap between two sections
 *     (Landing.tsx, SECTION_CARDS), so the requirement here is simply that
 *     the gap is longer than the lead: every boundary `pause` in
 *     chapters/coach.json is 2.6s or more, against leads of 2.6 to 3.0. Get
 *     that wrong and the next section's screen is on display before the
 *     title announcing it, which is exactly what the landing cut was doing
 *     for up to 2.6 seconds a section before anybody measured it.
 *  2. Movement is a glide, not a jump. The landing cut made every scroll
 *     instant because a smooth scroll to something far away overran its
 *     window; the fix is not to jump, it is to jump the distance nobody is
 *     watching and then glide the last part under the line. `place()` does
 *     the first, `glide()` does the second, and glide is driven by rAF
 *     inside the page — a loop of evaluate calls lands every 40 to 60ms and
 *     stutters at exactly the rate the capture records at.
 *
 * Shot from the staged coach (scripts/demos/stage_coach.sql):
 *
 *   Miguel Santos  07601580  handle `miguel`, 3 offerings, 4 orders
 *   ORDER_ACTIVE   0a5e0002…0001  John Miller, the Alex match, 3 findings
 *   ORDER_DONE     0a5e0002…0002  completed, so it reads as delivered
 *
 * ORDER_ACTIVE is pushed back to `submitted` by stage() so the video can
 * accept it on camera, and put back in cleanup(). Nothing else is written:
 * every pattern beat below only opens things.
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
 * This does not create an order, it rewinds one — which keeps the student,
 * the match and the three findings the later beats need, so the whole video
 * is one piece of work rather than several unrelated screens.
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
    body: JSON.stringify({ status: "submitted", accepted_at: null, promised_by: null }),
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

/**
 * Change page WITHOUT the change being on camera.
 *
 * Called in the silence before a line, with enough lead that the load, the
 * hydration and the settle are all finished before the sentence starts. The
 * second scroll is not superstition: hydration restores scrollTop and undoes
 * the first one, which is how a beat ends up filming the top of a page it
 * had already scrolled away from.
 */
export const arrive = async (page, clock, url, { at, anchor, offset = 120 }) => {
  await clock.until(at);
  await attempt(`arrive ${url.split("/").slice(-2).join("/")}`, async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    await clock.sleep(500);
    if (anchor) {
      await place(page, clock, anchor, offset);
      await clock.sleep(250);
      await place(page, clock, anchor, offset);
    }
  });
};

/** Put something at a known height, instantly, while nobody is watching. */
export const place = async (page, clock, text, offset = 120) =>
  page.evaluate(
    ([t, off]) => {
      const el = [...document.querySelectorAll("h1,h2,h3,p,label,span,button")].find(
        (e) => e.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
      );
      if (!el) return false;
      const y = window.scrollY + el.getBoundingClientRect().top - off;
      window.scrollTo(0, Math.max(0, y));
      // The workspace's left pane is its own scroll box on a laptop, so
      // moving the window moves nothing inside it — which is how the
      // pattern's own controls stayed a thousand pixels below the fold
      // while the flow believed it had scrolled to them. If the target is
      // still off screen, hand it to whichever ancestor actually scrolls.
      const r = el.getBoundingClientRect();
      if (r.bottom > window.innerHeight || r.top < 0) {
        el.scrollIntoView({ block: "center", behavior: "instant" });
      }
      return true;
    },
    [text, offset]
  );

/**
 * Move the page under a line, smoothly.
 *
 * Distance is measured to the target rather than guessed, and the duration
 * is the length of the line, so the movement finishes when the sentence
 * does. Eased at both ends: a linear scroll starting at full speed is the
 * thing that read as jagged.
 */
export const glide = async (page, clock, { to, ms, offset = 120, max = 1400 }) => {
  await attempt(`glide to ${to}`, () =>
    page.evaluate(
      ([t, dur, off, cap]) => {
        const el = [...document.querySelectorAll("h1,h2,h3,p,label,span,button")].find(
          (e) => e.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
        );
        if (!el) throw new Error("no target");
        const from = window.scrollY;
        const want = from + el.getBoundingClientRect().top - off;
        const dist = Math.max(-cap, Math.min(cap, want - from));
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur);
          const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          window.scrollTo(0, from + dist * e);
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
      [to, ms, offset, max]
    )
  );
};

/**
 * Highlight for the length of a beat.
 *
 * `min` defaults to a size that will not tuck its own label inside itself,
 * but the microphone beat genuinely wants two 36px circles, so it is
 * overridable and those cues carry no label at all.
 */
const spot = async (page, clock, { label, spec, until, min = 40 }) => {
  let entry = null;
  await attempt(`spot ${label ?? spec.sel ?? spec.text}`, async () => {
    const rect = await clock.rect(spec);
    if (!rect || rect.w < min || rect.h < min) throw new Error("rect too small to box");
    entry = clock.mark({ kind: "box", label, rect });
  });
  await clock.until(until);
  if (entry) clock.close(entry);
};

export const click = (page, label, text) =>
  attempt(label, () =>
    page.evaluate(
      ([t]) => {
        const el = [...document.querySelectorAll("h1,h2,h3,p,label,span,button")].find(
          (e) => e.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
        );
        if (!el) throw new Error(`nothing matched ${t}`);
        (el.closest("button") ?? el).click();
      },
      [text]
    )
  );

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
  return async function flow(page, clock, { beat, dismiss }) {
    const base = process.env.BASE ?? "https://www.ponglens.com";
    const WORK = `${base}/coaching/orders/${ORDER_ACTIVE}`;

    // ------------------------------------------------ 1. what this is
    // The coach's own home, with real orders and real money on it. The
    // first cut opened on their public profile, which is a page about them
    // rather than the thing they would use.
    await clock.until(beat("intro").end + 0.2);

    // ------------------------------------------------ 2-3. what you sell
    await arrive(page, clock, `${base}/coaching/offerings`, {
      at: beat("offer").start - 2.6,
      anchor: "Offerings",
      offset: 90,
    });
    await clock.until(beat("offer").start);
    await glide(page, clock, {
      to: "Receive review",
      ms: beat("offer").dur * 1000,
      offset: 320,
    });
    await clock.until(beat("offer").end + 0.3);
    // The one offering opened, then walked down. Opened in the gap so the
    // panel is already expanded when the line about changing it starts.
    await click(page, "open the offering", "Full match review");
    await clock.sleep(600);
    await place(page, clock, "Title", 140);
    await clock.until(beat("offer2").start);
    await glide(page, clock, {
      to: "What's included",
      ms: beat("offer2").dur * 1000,
      offset: 180,
    });
    await clock.until(beat("offer2").end);

    // ------------------------------------------------ 4. your page
    await arrive(page, clock, `${base}/coach/${COACH_HANDLE}`, {
      at: beat("page").start - 2.6,
      anchor: layout.pageAnchor,
      offset: layout.pageOffset ?? 110,
    });
    await clock.until(beat("page").start);
    await glide(page, clock, {
      to: layout.pageGlide,
      ms: beat("page").dur * 1000,
      offset: 180,
    });
    await clock.until(beat("page").end);

    // ------------------------------------------------ 5. sending the link
    await arrive(page, clock, `${base}/coaching`, {
      at: beat("link").start - 2.4,
      anchor: "Coaching",
      offset: 90,
    });
    await click(page, "open the QR", "QR");
    await clock.sleep(500);
    await clock.until(beat("link").end);

    // ------------------------------------------------ 6. payouts
    await click(page, "close the QR", "QR");
    await clock.sleep(300);
    await place(page, clock, "Payouts", 260);
    await clock.until(beat("payouts").start - 0.2);
    await spot(page, clock, {
      label: "Stripe pays your bank",
      spec: { sectionOf: "Payouts" },
      until: beat("payouts").end,
    });

    // ------------------------------------------------ 7-8. the order
    await arrive(page, clock, WORK, {
      at: beat("order").start - 2.6,
      anchor: "Their brief",
      offset: 150,
    });
    await clock.until(beat("order").start - 0.1);
    await spot(page, clock, {
      label: "What they asked for",
      spec: { sectionOf: "Their brief" },
      until: beat("order").end,
    });
    // The accept screen is the same page, so nothing loads here at all.
    await glide(page, clock, {
      to: "Accepting starts",
      ms: 1400,
      offset: 320,
    });
    // Clicked at the very end of the line, not before it: accepting
    // re-renders the whole page into the workspace, and at 1.6s early that
    // re-render happened under the last words of the sentence. In the gap
    // after it, it reads as the cut it is.
    await clock.until(beat("accept").end - 0.15);
    await click(page, "accept the order", "Accept and start");
    await clock.until(beat("accept").end);

    // ------------------------------------------------ 9. what arrives
    // The accept is filmed, but the workspace is NOT waited for on camera.
    // Letting the re-render carry the shot put the accept screen under the
    // first two pattern lines: the transition round trip is a second or
    // two against production, clock.until cannot rewind, and one late beat
    // makes every later beat late. So the accept happens, and then the
    // workspace is loaded properly inside the silence after the line, the
    // same way every other screen in this flow arrives.
    // Three seconds rather than the usual 2.4: this arrive is followed by a
    // wait for the score to render, and the wait has to finish inside the
    // card too. The gap here is 3.25s, so the card is already up.
    await arrive(page, clock, WORK, {
      at: beat("cut").start - 3.0,
      anchor: "The points",
      offset: 90,
    });
    await attempt("wait for the score", () =>
      page.waitForFunction(
        () => {
          const el = [...document.querySelectorAll("p")].find((e) =>
            e.textContent.trim().startsWith("Point ")
          );
          return !!el && !el.textContent.includes("unscored");
        },
        { timeout: 5000 }
      )
    );
    await clock.until(beat("cut").end);

    // ------------------------------------------- 10-13. finding the pattern
    // The heart of it, and the thing the first cut breezed past. Watch,
    // spot the habit, name it, put a picture or a voice on it, and then
    // keep adding the points where it happens again.
    await attempt("play the clip", () =>
      page.evaluate(() => {
        const v = document.querySelector("video");
        if (v) void v.play();
      })
    );
    await clock.until(beat("pattern1").end);

    // Naming it: the sheet that turns this point into a pattern.
    await attempt("pause the clip", () =>
      page.evaluate(() => document.querySelectorAll("video").forEach((v) => v.pause()))
    );
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
    await clock.sleep(350);
    await click(page, "open the pattern sheet", "Add to a pattern");
    await clock.sleep(450);
    await clock.until(beat("pattern2").end);
    await attempt("close the pattern sheet", () =>
      dismiss(page, {
        click: { text: "Cancel", tag: "button" },
        gone: { text: "Cancel", tag: "button" },
      })
    );

    // A picture or a voice on it: the pattern opened, its own controls in
    // frame. Expanding is read-only, so nothing here writes.
    await click(page, "open the pattern", "The long serve is landing");
    await clock.sleep(600);
    await place(page, clock, "Draw on the frame", 300);
    await clock.until(beat("pattern3").start - 0.1);
    // The button itself, not the section around it: the pattern title is a
    // <p> inside a button, so there is no heading for `sectionOf` to find
    // and the first take drew nothing at all here.
    await spot(page, clock, {
      label: "Draw on the frame",
      spec: { text: "Draw on the frame", tag: "button" },
      until: beat("pattern3").end,
      min: 30,
    });

    // The proof: the patterns collapsed back to a list, each carrying the
    // points it was built from. No ring — three rows with their numbers on
    // the right IS the picture, and a box around a list of boxes is noise.
    await click(page, "collapse the pattern", "The long serve is landing");
    await clock.sleep(400);
    await glide(page, clock, {
      to: "The long serve is landing",
      ms: 1200,
      offset: 300,
    });
    await clock.until(beat("pattern4").end);

    // ------------------------------------------------ 14. dictation
    await glide(page, clock, {
      to: "Your write-up",
      ms: 1500,
      offset: 90,
    });
    await clock.until(beat("dictate").start - 0.1);
    // Two 36px circles on the microphones, and no label chips: a chip on a
    // target this small sits on top of the thing it is naming.
    const mics = [];
    for (const nth of [0, 1]) {
      await attempt(`mic ${nth}`, async () => {
        const rect = await clock.rect({
          sel: '[aria-label="Dictate into this section"]',
          nth,
        });
        if (!rect || rect.w < 20) throw new Error("no microphone");
        mics.push(clock.mark({ kind: "box", rect }));
      });
    }
    await clock.until(beat("dictate").end);
    for (const m of mics) clock.close(m);

    // ------------------------------------------------ 15-16. the tools
    await glide(page, clock, { to: "Tools", ms: 1200, offset: 110 });
    await clock.until(beat("tidy").start - 0.1);
    await spot(page, clock, {
      label: "Tidy up",
      spec: { text: "Tidy up", tag: "button" },
      until: beat("tidy").end,
      min: 30,
    });
    await clock.until(beat("check").start - 0.1);
    await spot(page, clock, {
      label: "Checked before it goes",
      spec: { sel: "ul", visible: true, min: { w: 200, h: 90 } },
      until: beat("check").end,
    });

    // ------------------------------------------------ 17. attachments
    // Files the coach already has, which is a different thing from the
    // points on a pattern. The first cut ran the two together.
    await glide(page, clock, { to: "Attachments", ms: 1200, offset: 110 });
    await clock.until(beat("attach").start - 0.1);
    await spot(page, clock, {
      label: "Your own drills or plan",
      spec: { sectionOf: "Attachments" },
      until: beat("attach").end,
      min: 30,
    });

    // ------------------------------------------------ 18. what they get
    await arrive(page, clock, `${base}/coaching/orders/${ORDER_DONE}`, {
      at: beat("deliver").start - 3.0,
      anchor: "Summary",
      offset: 120,
    });
    await clock.until(beat("deliver").start);
    await glide(page, clock, {
      to: "Watch these points",
      ms: beat("deliver").dur * 1000 + 600,
      offset: 140,
      max: 2200,
    });
    await clock.until(beat("deliver").end);

    // ------------------------------------------------ 19. getting paid
    await arrive(page, clock, `${base}/coaching`, {
      at: beat("paid").start - 2.6,
      anchor: "Coaching",
      offset: 90,
    });
    await clock.until(beat("paid").end);

    // The closing line is spoken over the logo by the composition, so the
    // capture simply ends here.
  };
}
