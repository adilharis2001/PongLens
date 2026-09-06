/** Chapter 8 — what the coach relationship looks like from both sides. */
import { account, coach } from "../account.mjs";
export { account };

const MATCH = "efff9208-abf2-4a20-a498-18cc5a5130b3";
const STUDENT = "0a5e0004-0000-4000-8000-000000000001";
// A published demo rally with a verified playable clip. The narration
// teaches the feedback controls; it does not require a prewritten note.
const POINT = 48;
const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";

export const entry = "/coaching";

async function magicLink(key, email, next, base) {
  const response = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const data = await response.json();
  if (!data.hashed_token) throw new Error(`magic link failed for ${email}`);
  return `${base}/auth/confirm?token_hash=${data.hashed_token}&type=email&next=${encodeURIComponent(next)}`;
}

export async function prepare(page) {
  await page.waitForSelector("text=Add a coach", { timeout: 90000 });
  await page.waitForTimeout(1800);
}

const padded = (rect, pad = 10) => ({ x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 });

async function bring(page, clock, text, tags = "h1, h2, h3, button") {
  await page.evaluate(([target, selector]) => {
    [...document.querySelectorAll(selector)]
      .find((node) => node.textContent.trim().startsWith(target))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [text, tags]);
  await clock.sleep(700);
}

export async function flow(page, clock, { beat, voice, union, dismiss, serviceKey, base }) {
  const origin = base ?? new URL(page.url()).origin;

  const invite = beat("invite");
  await bring(page, clock, "Add a coach");
  await clock.until(invite.start + 0.1);
  const coachRow = await clock.rect({ text: "Add a coach", tag: "button" });
  const inviteMark = clock.mark({ kind: "box", label: "Invite your coach", rect: coachRow });
  await clock.until(invite.start + Math.min(1.5, invite.dur * 0.45));
  await page.click("button:has-text('Add a coach')");
  await page.waitForSelector("text=Share with coach", { timeout: 20000 });
  await clock.sleep(400);
  clock.close(inviteMark);
  const allMatches = await clock.rect({ text: "All my matches", tag: "p, label, span" });
  const thisMatch = await clock.rect({ text: "Only matches I share", tag: "p, label, span" });
  const scopeMark = clock.mark({ kind: "box", label: "One match or every match", rect: union(allMatches, thisMatch) });
  await clock.until(invite.end);
  clock.close(scopeMark);
  await dismiss(page, { click: { aria: "Close" }, gone: { text: "Share with coach" } });

  const coachLink = await magicLink(serviceKey, coach(), `/match/${MATCH}?p=${POINT}`, origin);
  await page.goto(coachLink);
  await page.waitForSelector('[aria-label="Close point view"]', { timeout: 60000 });
  // The point sheet mounts before its clip: /api/media-url still has to
  // authorize the coach and sign the R2 object. On a cold dev route that
  // routinely takes longer than the old fixed 900 ms sleep, leaving the
  // recorded screen on "Loading clip…" and no <video> for the cue. Wait on
  // the product state the narration actually promises.
  await page.waitForSelector('[role="dialog"] video', { timeout: 20000 });
  await clock.sleep(300);

  const sees = beat("sees");
  await clock.until(sees.start + 0.1);
  const pointVideo = await clock.rect({ sel: "video", within: { sel: '[role="dialog"]' }, min: { w: 200, h: 90 } });
  const seesMark = clock.mark({ kind: "box", label: "The same rally and score", rect: pointVideo });
  await clock.until(sees.end);
  clock.close(seesMark);

  const feedback = beat("feedback");
  await bring(page, clock, "Notes", "h2, h3");
  await clock.until(feedback.start + 0.1);
  const note = await clock.rect({ text: "Notes", tag: "h2, h3", within: { sel: '[role="dialog"]' } });
  const microphone = await clock.rect({ aria: "Record a voice note", within: { sel: '[role="dialog"]' } });
  const draw = await clock.rect({ text: "Draw", tag: "button", within: { sel: '[role="dialog"]' } });
  const feedbackMark = clock.mark({ kind: "box", label: "Written, spoken, or drawn", rect: union(note, microphone, draw) });
  await clock.until(feedback.end);
  clock.close(feedbackMark);

  const lessonEntries = beat("lesson-entries");
  await page.goto(`${origin}/coaching/students/${STUDENT}`);
  await page.waitForSelector("text=Journal", { timeout: 60000 });
  await clock.sleep(700);
  await clock.until(lessonEntries.start + 0.1);
  const journalHeading = await clock.rect({ text: "Journal", tag: "h3" });
  const newEntry = await clock.rect({ text: "New entry", tag: "button" });
  const lessonMark = clock.mark({ kind: "box", label: "Lesson entries", rect: union(journalHeading, newEntry) });
  await clock.until(lessonEntries.end);
  clock.close(lessonMark);

  const journal = beat("journal");
  const playerLink = await magicLink(serviceKey, account, "/journal", origin);
  await page.goto(playerLink);
  await page.waitForSelector("text=Recollect", { timeout: 60000 });
  await clock.sleep(800);
  await clock.until(journal.start + 0.1);
  const coachEntry = await clock.rect({ text: "Tutorial fixture:", tag: "p, span, div" });
  const journalMark = clock.mark({ kind: "box", label: "Coach feedback in Journal", rect: padded(coachEntry) });
  await clock.until(journal.end);
  clock.close(journalMark);

  const boundaries = beat("boundaries");
  const coachAgain = await magicLink(serviceKey, coach(), `/match/${MATCH}`, origin);
  await page.goto(coachAgain);
  await page.waitForSelector("text=Points", { timeout: 60000 });
  await clock.sleep(700);
  await clock.until(boundaries.start + 0.1);
  const points = await clock.rect({ text: "Points", tag: "h2" });
  const boundariesMark = clock.mark({ kind: "box", label: "Review without changing", rect: padded(points, 12) });
  await clock.until(boundaries.end);
  clock.close(boundariesMark);

  const access = beat("access");
  const playerAgain = await magicLink(serviceKey, account, "/coaching", origin);
  await page.goto(playerAgain);
  await page.waitForSelector("text=Add a coach", { timeout: 30000 });
  await bring(page, clock, "Add a coach");
  await clock.until(access.start + 0.1);
  const accessRow = await clock.rect({ text: "Add a coach", tag: "button" });
  const accessMark = clock.mark({ kind: "box", label: "You control access", rect: accessRow });
  await clock.until(access.end);
  clock.close(accessMark);
  await clock.until(voice.total + 0.4);
}
