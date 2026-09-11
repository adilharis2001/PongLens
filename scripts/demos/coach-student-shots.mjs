/** Local, read-only demo captures of the real app components. No account,
 * email, database or media processing mutations. Existing video cuts untouched.
 * BASE=http://localhost:3024 node scripts/demos/coach-student-shots.mjs
 */
import { chromium } from 'playwright';
import { constants } from 'node:fs';
import { copyFile, mkdir, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://localhost:3024';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error('Local capture only');
const routeDir = new URL('../../src/app/qa-coach-capture/', import.meta.url);
const routeFile = new URL('page.tsx', routeDir);
const out = new URL('../../public/showcase/', import.meta.url);
const coach = '07601580-0ce3-4a4f-82b0-10ea04cac180';
const player = '6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4';
const studentId = '0a5e0004-0000-4000-8000-000000000001';
const lessonId = '0a5e0005-0000-4000-8000-000000000001';
const recapLessonId = '0a5e0005-0000-4000-8000-000000000002';
const videoId = '0a5e0006-0000-4000-8000-000000000001';
const date = '2026-09-09T12:00:00Z';
const student = { id: studentId, coach_id: coach, player_id: player, display_name: 'John Miller', created_at: date, archived_at: null };
const themes = [
  { name: 'Backhand block', points: ['Keep the movement short and contact the ball in front.', 'Recover your ready position after each block.'] },
  { name: 'First attack', points: ['Move towards the long ball and play forward.', 'Finish balanced so you can play the next ball.'] },
];
const edit = { title: 'Backhand block and first attack', themes, chapters: [
  { title: 'Keep the block short', cues: themes[0].points, start_s: 120, end_s: 195, summary_start_s: 0, summary_end_s: 75 },
  { title: 'Recover for the next ball', cues: ['Return to your ready position after contact.'], start_s: 420, end_s: 485, summary_start_s: 75, summary_end_s: 140 },
  { title: 'Make the first attack', cues: themes[1].points, start_s: 900, end_s: 1000, summary_start_s: 140, summary_end_s: 240 },
] };
const video = { id: videoId, owner_id: coach, student_id: studentId, coach_ref_id: null, lesson_id: recapLessonId, original_name: 'Backhand lesson.mov', file_size: 1024 ** 3, duration_s: 3600, status: 'ready', stage: null, error: null, edit, created_at: date, updated_at: date, revision: 1, shared: true };
const lessons = [
  { id: lessonId, transcript: themes[0].points.join(' '), takeaways: { title: 'Backhand block and first attack', themes }, status: 'ready', match_id: null, image_path: null, lesson_video_id: null, created_at: date },
  { id: recapLessonId, transcript: 'Lesson video recap', takeaways: { title: 'Backhand lesson recap', themes: [] }, status: 'ready', match_id: null, image_path: null, lesson_video_id: videoId, created_at: date },
];
await mkdir(routeDir, { recursive: true });
await copyFile(new URL('../qa/fixtures/coach-landing-capture-page.tsx', import.meta.url), routeFile, constants.COPYFILE_EXCL);
let browser;
try {
  browser = await chromium.launch({ headless: true });
  // Wait for Next's route watcher, not just for the file to exist.
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch(`${base}/qa-coach-capture`).catch(() => null);
    if (response?.status === 200) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'local fixture route is ready');
  for (const viewport of [{ width: 390, height: 844 }, { width: 1180, height: 820 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce', timezoneId: 'America/New_York' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://*.supabase.co/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const name = url.pathname.split('/').pop();
      if (request.method() !== 'GET' && name !== 'student_shared_lessons') {
        errors.push(`Capture cannot mutate ${name}`);
        return route.abort();
      }
      let data;
      if (name === 'user') data = { id: coach, email: 'miguel-demo@example.com', app_metadata: {}, user_metadata: {} };
      else if (name === 'coach_students') data = url.searchParams.has('id') ? student : [student];
      else if (name === 'coach_entries') data = lessons.map((l, i) => ({ id: `entry-${i}`, student_id: studentId, lesson_id: l.id, shared_at: date, created_at: date }));
      else if (name === 'lessons') data = lessons;
      else if (name === 'matches') data = [{ id: 'efff9208-abf2-4a20-a498-18cc5a5130b3', opponent_name: 'Alex', original_name: 'Club match', match_type: 'practice', venue: 'Club practice', played_at: date, status: 'ready' }];
      else if (name === 'student_shared_lessons') data = [{ lesson_id: 'student-entry', student_id: player, student_name: 'John Miller', transcript: 'The shorter block helped in practice. I want to work on recovering sooner.', takeaways: null, image_path: null, match_id: null, shared_at: date, created_at: date, lesson_video_id: null }];
      else if (name === 'app_config') data = { value: 'false' };
      else if (['points', 'notifications', 'profiles', 'coaches'].includes(name)) data = [];
      else { errors.push(`Unexpected Supabase request: ${name}`); return route.abort(); }
      await route.fulfill({ json: data });
    });
    await context.route(`${base}/api/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET') { errors.push(`Capture cannot mutate ${url.pathname}`); return route.abort(); }
      if (url.pathname === '/api/lesson-video') return route.fulfill({ json: url.searchParams.has('id') ? { video, edit, isOwner: true, shared: true, playbackUrl: '/demo/coach-mobile.mp4', posterUrl: '/showcase/coach-demo-thumb.jpg', link: null, file: { state: 'none' } } : { videos: [video] } });
      if (url.pathname.startsWith('/api/thumb/')) return route.fulfill({ path: new URL('coach-demo-thumb.jpg', out).pathname, contentType: 'image/jpeg' });
      errors.push(`Unexpected API request: ${url.pathname}`);
      await route.abort();
    });
    const shot = async name => {
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      for (const img of await page.locator('img').all()) await img.evaluate(el => el.decode());
      await page.screenshot({ path: new URL(name + '.jpg', out).pathname, type: 'jpeg', quality: 90, animations: 'disabled' });
      console.log(name, viewport.width * 2, viewport.height * 2);
    };
    await page.goto(`${base}/qa-coach-capture`, { waitUntil: 'networkidle' });
    await page.getByText('Backhand lesson recap', { exact: true }).waitFor();
    await shot(viewport.width === 390 ? 'coach-student-current-m' : 'coach-student-current-t');
    if (viewport.width === 390) {
      await page.goto(`${base}/qa-coach-capture?screen=summary`, { waitUntil: 'networkidle' });
      await page.getByText('Keep the movement short and contact the ball in front.', { exact: true }).waitFor();
      await shot('coach-summary-current-m');
      await page.goto(`${base}/qa-coach-capture?screen=recap`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Backhand block and first attack', exact: true }).waitFor();
      await shot('coach-recap-current-m');
      await page.getByText('Keep the block short', { exact: true }).scrollIntoViewIfNeeded();
      await shot('coach-recap-chapters-current-m');
    }
    assert.deepEqual(errors, [], 'capture must render without client exceptions');
    await context.close();
  }
} finally {
  try { await browser?.close(); } finally { await unlink(routeFile); }
}
