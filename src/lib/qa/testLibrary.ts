/**
 * The test library: what to test, and what correct looks like.
 *
 * Plain data, the same way src/app/learn/guides.ts holds the Learn hub's
 * content. In code rather than the database so it is reviewed in git and
 * changes in the same commit as the UI it describes.
 *
 * Written for someone who does not play table tennis and did not build
 * this. That is what `why` is for: it carries the rule of the sport or the
 * product decision that makes the expected result the expected result. A
 * case whose `why` reads "so it works" is not finished.
 *
 * Depth:
 *   smoke — run on every deploy. Sign in, upload, process, score, watch.
 *   core  — the weekly sweep.
 *   edge  — worth doing once, then when the area changes.
 *
 * When the product changes, change the case in the same commit. A test
 * library that describes last month's UI teaches a tester to file noise.
 */

export const TEST_AREAS = [
  { key: "landing", title: "Landing and public pages" },
  { key: "auth", title: "Sign in and onboarding" },
  { key: "nav", title: "Navigation and shell" },
  { key: "upload", title: "Upload and import" },
  { key: "processing", title: "Processing" },
  { key: "match", title: "The match page" },
  { key: "scoring", title: "Scoring" },
  { key: "placement", title: "Placement maps" },
  { key: "notes", title: "Notes and voice" },
  { key: "journal", title: "Journal" },
  { key: "lessons", title: "Coaching tab and lessons" },
  { key: "stats", title: "My game" },
  { key: "sharing", title: "Sharing and coach access" },
  { key: "coaching", title: "Coach side" },
  { key: "orders", title: "Paid reviews" },
  { key: "learn", title: "Learn" },
  { key: "account", title: "Account, storage and minutes" },
  { key: "email", title: "Email" },
  { key: "feedback", title: "Feedback board" },
] as const;

export type TestArea = (typeof TEST_AREAS)[number]["key"];
/**
 * Where a case is run. Four surfaces, because a pass on one says nothing
 * about the others: the responsive web app and the native app are separate
 * builds, and desktop and phone are separate layouts inside the web one.
 *
 * There is no Android build yet, so that surface reads zero until there
 * is. It is tagged anyway — the cases would be the same ones, and the day
 * the app exists the tracking is already here.
 */
export type TestSurface = "web-desktop" | "web-mobile" | "ios" | "android";

export const TEST_SURFACES = [
  { key: "web-desktop", title: "Web desktop", short: "Desktop" },
  { key: "web-mobile", title: "Web mobile", short: "Mobile web" },
  { key: "ios", title: "iOS app", short: "iOS" },
  { key: "android", title: "Android app", short: "Android" },
] as const satisfies readonly { key: TestSurface; title: string; short: string }[];
export type TestDepth = "smoke" | "core" | "edge";

/**
 * Depth is really a cadence, so it is shown as one. "Smoke" and "core"
 * are words this trade uses and a new tester does not, and the answer he
 * needs from the chip is how often, not how deep.
 *
 * The stored values stay smoke/core/edge: they are the vocabulary in the
 * file above and in every case id already written.
 */
export const DEPTH_META: Record<
  TestDepth,
  { chip: string; filter: string; blurb: string }
> = {
  smoke: {
    chip: "Release",
    filter: "Every release",
    blurb:
      "Run all of these before any release goes out. If one fails, the release waits.",
  },
  core: {
    chip: "Weekly",
    filter: "Weekly",
    blurb:
      "The full sweep, once a week, plus any area a release touched. npm run qa:affected turns a release into that list.",
  },
  edge: {
    chip: "Once",
    filter: "Once",
    blurb:
      "Run once, then again only when its area changes. These are the corners, not the path everyone walks.",
  },
};

export interface TestCase {
  /** Stable slug. Cited by bug reports and by the CSV, so do not rename. */
  id: string;
  area: TestArea;
  title: string;
  /** The rule of the sport, or the product decision, behind `expected`. */
  why: string;
  /** Preconditions. Say what state is needed, not how to get there. */
  needs?: string[];
  steps: string[];
  expected: string[];
  /**
   * Which surfaces this case is worth running on.
   *
   * Two questions decide it, and both must be yes: does the feature exist
   * there, and could running it there give a different answer. That second
   * one is why the cut, the arithmetic and the emails are tagged web only
   * — whether a rally survived the cut is a fact about the video, and
   * asking it four times on four screens returns the same answer four
   * times. Interface cases go everywhere the interface does.
   */
  surfaces: TestSurface[];
  depth: TestDepth;
  /** Set when the case cannot be run yet, with the reason. */
  blocked?: string;
  /**
   * The day the case was added or rewritten (ISO date). It reads as "New"
   * in the library for NEW_DAYS afterwards, so a tester arriving after a
   * big release runs those first instead of re-walking the old paths.
   */
  added?: string;
}

const ALL: TestSurface[] = ["web-desktop", "web-mobile", "ios", "android"];
/** Both web layouts. Most of the library: the app defers to the site. */
const WEB: TestSurface[] = ["web-desktop", "web-mobile"];
/** Anything held in one hand, whichever build it is running. */
const PHONE: TestSurface[] = ["web-mobile", "ios", "android"];
/** Needs a window you can resize, or a keyboard. */
const WEB_DESKTOP: TestSurface[] = ["web-desktop"];
/** A browser on a phone, which the app is not. */
const WEB_MOBILE: TestSurface[] = ["web-mobile"];
/** The native app only, whichever build: the camera, Instagram, and
 * links that open it. Android is tagged alongside iOS the way ALL and
 * PHONE do, so the two builds carry the same cases. */
const APP: TestSurface[] = ["ios", "android"];

export const testCases: TestCase[] = [
  {
    id: "match-private-cut-review",
    area: "match",
    title: "Private cut feedback respects the player's and coach's roles",
    why: "A report about one processed match is private. A coach may report a problem but cannot spend or return a player's minutes.",
    needs: ["A demo ready match with an owner and an accepted coach."],
    steps: ["As the owner, open Processing in Tools.", "Choose reprocessing or the exact minute request and write a draft.", "Interrupt a submission, then retry.", "Open the same match as its coach, open Processing and report a problem."],
    expected: ["Failure keeps the selected outcome and written draft. Retry creates one request.", "The coach has only a required-text report form, with no financial amount or remedy controls.", "The private request does not appear on the public Feedback board.", "Buttons remain reachable at 393×660 with a long title and keyboard space."],
    surfaces: ALL, depth: "core",
    added: "2026-09-07",
  },
  // -------------------------------------------------------------------------
  // Landing and public pages
  // -------------------------------------------------------------------------
  {
    id: "landing-loads",
    area: "landing",
    title: "The landing page loads and the walkthrough videos play",
    why: "The landing page is the only thing a stranger sees before deciding whether this is real. Its videos are served from public/, so a failure here is usually a missing file rather than a slow network.",
    steps: [
      "Open ponglens.com in a private window, signed out.",
      "Scroll the whole page to the footer.",
      "Play each walkthrough video in the sequence near the top.",
    ],
    expected: [
      "Every section renders with no missing images and no blank gaps.",
      "Each video plays without a download error and without stretching or squashing the picture.",
      "Nothing scrolls sideways. The page never becomes wider than the screen.",
    ],
    surfaces: WEB,
    depth: "smoke",
  },
  {
    id: "landing-faq",
    area: "landing",
    title: "The FAQ answers match what the product actually does",
    why: "The FAQ makes concrete promises about file size, formats and how long footage is kept. If the product changes and the FAQ does not, we are misleading people in writing.",
    steps: [
      "Open the FAQ section on the landing page.",
      "Read each answer against what you know from testing the app.",
    ],
    expected: [
      "The stated upload limit and accepted formats match what the upload screen enforces.",
      "The retention answer matches what the privacy page says.",
      "No answer describes a feature you cannot find in the app.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "landing-coaches",
    area: "landing",
    title: "The coaches page loads signed out and its call to action works",
    why: "Coaches arrive here from outreach, not from inside the app, so it has to work with no session at all.",
    steps: [
      "Open /coaches signed out.",
      "Scroll to the end and follow the set-up call to action.",
    ],
    expected: [
      "The page renders fully signed out.",
      "The call to action leads to a sign-in or setup page rather than an error.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "landing-legal",
    area: "landing",
    title: "Terms and Privacy load and are reachable from the footer",
    why: "These are linked from sign-up and from email. A broken legal page is the kind of thing nobody notices for months.",
    steps: [
      "Signed out, open the footer and follow Terms, go back, follow Privacy.",
      "Sign in, then reach both again from Account. There is no footer once you are signed in.",
    ],
    expected: [
      "Both pages render with their full text.",
      "The retention table on Privacy names the same time periods as the FAQ.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "landing-404",
    area: "landing",
    title: "A URL that does not exist shows the app's own not-found page",
    why: "Private pages deliberately answer with not-found rather than a permission error, so this page is load-bearing for privacy and not just for typos.",
    steps: ["Open ponglens.com/this-does-not-exist."],
    expected: [
      "The app's own styled not-found page appears.",
      "No stack trace, no framework default error screen.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "landing-private-pages-hidden",
    area: "landing",
    title: "Private workspaces do not confirm they exist",
    why: "Research, marketing and testing are gated to specific accounts. They answer not-found rather than access-denied on purpose: an access-denied page tells a stranger the page is there.",
    steps: [
      "Signed in as a normal player account, open /research.",
      "Then /marketing, then /admin, then /testing.",
    ],
    expected: [
      "Each one either shows not-found or sends you back to your dashboard.",
      "None of them says you lack permission, and none shows any of its content.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "landing-shared-metadata",
    area: "landing",
    title: "A pasted share link previews correctly in a chat app",
    why: "Share links are the product's word of mouth. If the preview is blank the link looks broken before anyone opens it.",
    needs: ["A share link created from a match's Share control, not the /match/ address in the address bar"],
    steps: [
      "Paste a share link into WhatsApp, iMessage or Slack without sending it.",
      "Wait for the preview card to build.",
    ],
    expected: [
      "A preview card appears with a title and an image.",
      "The title describes the match rather than saying PongLens alone.",
    ],
    surfaces: WEB_MOBILE,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Sign in and onboarding
  // -------------------------------------------------------------------------
  {
    id: "auth-magic-link",
    area: "auth",
    title: "Signing in with an emailed link works",
    why: "This is the only way into most accounts. It is also the one email path that deliberately ignores our bounce suppression, because locking someone out of their own account is worse than a reputation hit.",
    steps: [
      "Open /login signed out and enter your address.",
      "Open the email and follow the link.",
    ],
    expected: [
      "The link signs you in and lands you on the dashboard.",
      "The email arrives within a minute or two and comes from a ponglens.com address.",
      "Following the same link a second time does not sign you in again silently.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "auth-google",
    area: "auth",
    title: "Signing in with Google works",
    why: "Google accounts arrive with a name and avatar already set, which means they skip part of onboarding that email sign-ups see.",
    steps: ["Open /login signed out.", "Choose Google and complete the flow."],
    expected: [
      "You land on the dashboard signed in.",
      "Your name and avatar appear in the top right.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "auth-redirect-back",
    area: "auth",
    title: "Signing in returns you to the page you were trying to reach",
    why: "People arrive on a shared match or a coach invite before they have an account. Dumping them on the dashboard after sign-in loses whatever they came for.",
    steps: [
      "Signed out, open a link to a private page such as /journal.",
      "Sign in when asked.",
    ],
    expected: ["After signing in you land on /journal, not on the dashboard."],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "auth-onboarding-profile",
    area: "auth",
    title: "A new account is asked for a name, whether it plays or coaches, and a playing profile, once",
    why: "Onboarding asks for a name, then whether this account is here to play or to coach, then the playing profile: handedness, grip and rubbers, because a coach reading a match needs them. A coach answers the name and lands on the coaching side. It is offered once and can be skipped, and being asked twice is a bug.",
    needs: ["An account that has never signed in"],
    steps: [
      "Sign in with a brand new address.",
      "Complete or skip each onboarding step.",
      "Sign out, sign back in.",
    ],
    expected: [
      "Onboarding appears on the first sign-in only.",
      "Skipping is allowed and does not block the app.",
      "The second sign-in goes straight to the home of the side you chose.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "auth-signed-out-private",
    area: "auth",
    title: "Signed out, private pages send you to sign in",
    why: "Every page under the app shell holds someone's footage. The redirect is the first of two gates; the database is the real one.",
    steps: [
      "Sign out.",
      "Open /dashboard, /matches, /journal and /account in turn.",
    ],
    expected: ["Each one sends you to the login page rather than rendering."],
    surfaces: WEB,
    depth: "smoke",
  },
  {
    id: "auth-sign-out",
    area: "auth",
    title: "Signing out ends the session on this device",
    why: "A sign-out that only clears the menu leaves the session alive, which matters on a shared or borrowed device. It is this device only: signing out of a laptop must not sign a phone out, which is what happened until September 2026.",
    added: "2026-09-08",
    steps: [
      "Sign out from the account menu.",
      "Press the browser back button.",
      "Open /dashboard directly.",
    ],
    expected: [
      "Back does not reveal the signed-in page.",
      "/dashboard sends you to login.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "auth-wrong-link",
    area: "auth",
    title: "An expired or reused sign-in link fails cleanly",
    why: "Links expire. The failure should say so in plain words rather than showing a raw error, because this is the moment a new user decides the product is broken.",
    steps: [
      "Request a sign-in link and wait for it to expire, or use one twice.",
      "Follow the stale link.",
    ],
    expected: [
      "A readable message explains the link is no longer valid and offers a new one.",
      "No raw error text or blank page.",
    ],
    surfaces: WEB,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Navigation and shell
  // -------------------------------------------------------------------------
  {
    id: "nav-three-tabs",
    area: "nav",
    title: "The bottom bar holds Home, Matches, Journal and Coaching, and each works",
    why: "The bar holds destinations only. Coaching joined it in September 2026 for every player, whether or not they have a coach yet. Upload is a task and floats as a button on the pages it acts on, so if Upload appears in the bar something has regressed.",
    steps: ["Sign in on a phone.", "Tap each of the four tabs in turn."],
    expected: [
      "Exactly four destinations appear in the bar: Home, Matches, Journal, Coaching.",
      "The current tab is visibly the current one.",
      "No tab is cut off by the phone's home indicator.",
    ],
    surfaces: PHONE,
    depth: "smoke",
    added: "2026-09-08",
  },
  {
    id: "nav-desktop-header",
    area: "nav",
    title: "Desktop shows one header, with Upload alongside the phone bar's four",
    why: "The phone and desktop layouts are separate markup that both render, so they can drift apart without anyone noticing. Coaching joined the bar in September 2026 and has to be in the header too.",
    steps: ["Sign in on a desktop browser.", "Use each destination in the header."],
    expected: [
      "The header carries Home, Upload, Matches, Journal and Coaching. Upload is desktop only, on purpose: the floating upload button sits outside the reading column on a wide monitor and gets missed.",
      "The bell and avatar sit at the top right.",
    ],
    surfaces: WEB_DESKTOP,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "nav-bell",
    area: "nav",
    title: "The notification bell shows unread items and clears them",
    why: "The bell is how a player learns their match is ready or their coach left a note. An unread count that never clears trains people to ignore it.",
    needs: ["At least one unread notification"],
    steps: ["Tap the bell.", "Open one notification.", "Return and reopen the bell."],
    expected: [
      "The unread count matches the number of unread rows.",
      "Opening a notification takes you to the thing it is about.",
      "The count drops once read.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "nav-responsive-switch",
    area: "nav",
    title: "Resizing between phone and desktop widths leaves one layout showing",
    why: "Both layouts are always in the page, with one hidden by CSS. If a resize leaves both visible, or leaves two videos playing, that is the failure this case exists to catch.",
    steps: [
      "Open a match on a desktop browser.",
      "Drag the window narrow enough to cross into the phone layout and back.",
    ],
    expected: [
      "Only one layout is ever visible.",
      "No control appears twice.",
      "No sound continues from a player you can no longer see.",
    ],
    surfaces: WEB_DESKTOP,
    depth: "core",
  },
  {
    id: "nav-back-button",
    area: "nav",
    title: "The browser back button behaves everywhere",
    why: "Sheets and overlays that do not register history turn back into an app exit, which on a phone feels like losing your work.",
    steps: [
      "Open a match, open a point, open the share sheet.",
      "Press back three times.",
    ],
    expected: [
      "Back closes the sheet, then the point, then returns to the match list.",
      "Back never leaves the app while an overlay is open.",
    ],
    surfaces: WEB_MOBILE,
    depth: "core",
  },

  // -------------------------------------------------------------------------
  // Upload and import
  // -------------------------------------------------------------------------
  {
    id: "upload-file-happy",
    area: "upload",
    title: "Uploading a match video from the phone works end to end",
    why: "This is the front door of the product. Most recordings are a phone file of a full session, so this is the path almost every real upload takes.",
    needs: ["A match video on the device, MP4 or MOV, under 45 minutes"],
    steps: [
      "On the app, tap New match and choose the library; on the web, open Upload.",
      "Choose the video file.",
      "Fill in the opponent name and leave the options at their defaults.",
      "Start the upload and watch it to completion.",
    ],
    expected: [
      "A progress indicator moves and reaches the end.",
      "The screen confirms the upload and says processing has started.",
      "The match appears in your library straight away, before processing finishes.",
    ],
    surfaces: ALL,
    depth: "smoke",
    added: "2026-09-08",
  },
  {
    id: "upload-options",
    area: "upload",
    title: "The processing options on an unprocessed match do what they say",
    why: "The options moved off the upload page: a video lands in the library first, and the match page's process step is where the choices are made, so they can be changed before any minutes are spent. Breaking into points is on by default and placement maps are off, because placement adds real processing time. Cut strictness changes how much room sits around each rally, and the trim marks which stretch of the recording is the match.",
    needs: ["A video in the library that has not been processed"],
    steps: [
      "Open the unprocessed match and open the process step.",
      "Trim the start and end, toggle Break it into points, toggle Placement maps on, and move Cut strictness through Tight, Normal and Loose.",
      "Leave the match and come back.",
    ],
    expected: [
      "Break it into points starts on and placement starts off, with a note that placement adds processing time.",
      "The minutes shown follow the trim.",
      "Each control keeps its setting until processing starts.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "upload-leave-guard",
    area: "upload",
    title: "Leaving mid-upload warns you first",
    why: "An upload is minutes of a phone's data. Navigating away silently and losing it is the kind of thing that stops someone using the product.",
    steps: [
      "Start an upload of a large file.",
      "While it is running, try to navigate away or close the tab.",
    ],
    expected: [
      "A confirmation asks whether you really want to leave.",
      "Staying keeps the upload running from where it was.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "upload-rejects-non-video",
    area: "upload",
    title: "A file that is not a video is refused",
    why: "The picker restricts by type, but a determined user can still choose something odd. The refusal should happen before the bytes are uploaded, not after.",
    steps: ["Try to upload a PDF or an image."],
    expected: [
      "The file is refused with a message naming the accepted formats.",
      "Nothing uploads and no match row is created.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "upload-not-table-tennis",
    area: "upload",
    title: "A video that is not table tennis is turned away",
    why: "Processing is expensive, so a handful of frames are checked before any real work starts. This is deliberately generous: if the check is unsure, it lets the video through.",
    steps: [
      "Upload a short video that is clearly not table tennis, for example someone talking to camera.",
      "Wait for processing to reach a conclusion.",
    ],
    expected: [
      "The match fails with a plain message saying it does not look like table tennis.",
      "Nothing is charged against your processing minutes for the rejected video.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "upload-minutes-gate",
    area: "upload",
    title: "Running out of processing minutes stops processing, not the upload",
    why: "Minutes pay for the vision pipeline, not for storage. A video you cannot process yet should still be in your library so you can process it after topping up.",
    needs: ["An account with fewer processing minutes than the video is long"],
    steps: ["Upload a video longer than your remaining minutes."],
    expected: [
      "The upload completes and the video is in the library.",
      "A message says processing needs more minutes than you have.",
      "The library entry can be opened and watched.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "upload-metadata",
    area: "upload",
    title: "Opponent, venue and match type are saved with the match",
    why: "These are how a match is found again months later, and the venue feeds the club-level work. A field that silently fails to save loses that quietly.",
    steps: [
      "Fill in opponent name, club or location, and pick Tournament or Practice.",
      "Complete the upload and open the match.",
    ],
    expected: ["All three values appear on the match when it opens."],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "upload-background",
    area: "upload",
    title: "An upload survives the phone locking or the app going to the background",
    why: "A full match is a large file on a phone connection. People lock the screen while it runs.",
    steps: [
      "Start an upload on a phone.",
      "Lock the screen for thirty seconds, then return.",
    ],
    expected: [
      "The upload either continued or resumed rather than starting over.",
      "The progress indicator reflects reality.",
    ],
    surfaces: PHONE,
    depth: "core",
  },
  {
    id: "upload-two-at-once",
    area: "upload",
    title: "Starting a second upload while one is running is handled",
    why: "Uploads are queued jobs. Two at once should either both work or be prevented clearly, never half-start.",
    steps: ["Start an upload, then try to start another before it finishes."],
    expected: [
      "Either both uploads run and both matches appear, or the second is refused with a reason.",
      "Neither upload corrupts the other's progress display.",
    ],
    surfaces: WEB,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Processing
  // -------------------------------------------------------------------------
  {
    id: "processing-progress",
    area: "processing",
    title: "Processing shows progress and finishes",
    why: "Processing runs on a machine that polls for work, so the dashboard reflects it by asking every few seconds rather than being pushed to. Progress that sticks at one number for many minutes is worth reporting with the match id.",
    steps: [
      "Upload a match and stay on the dashboard.",
      "Watch the match card until it is ready.",
    ],
    expected: [
      "The card shows a processing state with a percentage that advances.",
      "It reaches ready without the page being reloaded by hand.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "processing-email",
    area: "processing",
    title: "The ready email arrives and its link opens the match",
    why: "Processing takes long enough that people leave. The email is what brings them back, so a broken link here costs the whole session.",
    steps: ["Upload a match and wait for the email."],
    expected: [
      "An email arrives when the match is ready.",
      "Its link opens that match, signing in if needed.",
    ],
    surfaces: WEB,
    depth: "smoke",
  },
  {
    id: "processing-cut-keeps-play",
    area: "processing",
    title: "The cut keeps every rally",
    why: "This is the single most important accuracy check in the product. A point runs from the serve being struck to the ball going dead. Dead time left in is a small annoyance; a rally cut out is footage the player has lost, and it is much worse.",
    needs: ["A processed match, and the original recording to compare against"],
    steps: [
      "Watch the full original recording and count the rallies.",
      "Watch the cut version and count again.",
    ],
    expected: [
      "Every rally in the original appears in the cut.",
      "No rally starts after the serve has already been struck.",
      "No rally is cut off before the ball goes dead.",
    ],
    surfaces: WEB,
    depth: "smoke",
  },
  {
    id: "processing-point-boundaries",
    area: "processing",
    title: "Each point clip holds exactly one point",
    why: "Two rallies merged into one clip breaks scoring, because the player is asked who won a clip that contains two answers. One rally split across two clips does the same in reverse.",
    needs: ["A processed match with points"],
    steps: [
      "Open the point list and play the first fifteen clips in order.",
      "For each, note whether it contains exactly one rally.",
    ],
    expected: [
      "Each clip contains one rally and one only.",
      "The clips are in the order the points were played.",
    ],
    surfaces: WEB,
    depth: "smoke",
  },
  {
    id: "processing-dead-time",
    area: "processing",
    title: "Obvious dead time is removed",
    why: "The promise is that a twenty minute recording becomes the five minutes that matter. Ball chasing, toweling off and long gaps between games should be gone.",
    needs: ["A processed match whose original has long gaps"],
    steps: ["Watch the cut version and note anything that is not live play."],
    expected: [
      "Ball retrieval and between-game breaks are largely gone.",
      "What remains between points is short.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "processing-failure-message",
    area: "processing",
    title: "A failed match says so in plain words",
    why: "Processing can fail on a corrupt file or an unreadable angle. The failure has to be legible, because the player's next move is either to re-record or to write to support.",
    needs: ["A match that failed processing"],
    steps: ["Find a failed match in the library and open it."],
    expected: [
      "The card and the page both show a failed state.",
      "The message says what went wrong in ordinary language.",
      "There is a way to delete it or try again.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "processing-library-then-process",
    area: "processing",
    title: "A video imported to the library can be processed later",
    why: "Import and processing are separate steps, so footage can sit in the library until you decide to spend minutes on it.",
    needs: ["A match in the library that has not been processed"],
    steps: ["Open the unprocessed match.", "Start processing from there."],
    expected: [
      "The video plays before processing.",
      "Processing can be started and moves the match into a processing state.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "processing-long-match",
    area: "processing",
    title: "A recording near the 45 minute limit processes without timing out",
    why: "45 minutes is the hard limit, and the minutes either side of it are where memory and timeout problems appear. Anything longer is refused on purpose, so testing an hour tests the refusal, not the pipeline.",
    needs: ["A recording of 40 to 45 minutes"],
    steps: [
      "Upload a recording just under 45 minutes and follow it to completion.",
      "Then try one over 45 minutes and read what it says.",
    ],
    expected: [
      "The under-limit one completes rather than stalling or failing.",
      "The point count is plausible for the length of the session.",
      "The over-limit one is turned away with a message naming the 45 minute limit, and says so before it wastes an upload rather than after.",
    ],
    surfaces: WEB,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // The match page
  // -------------------------------------------------------------------------
  {
    id: "match-open",
    area: "match",
    title: "A finished match opens and the cut plays",
    why: "The match page is the core screen of the product. Everything else is reached from it.",
    needs: ["A processed match"],
    steps: ["Open the match from the library.", "Play the cut video."],
    expected: [
      "The video fills the width it is given without letterboxing inside its own box.",
      "Playback starts within a couple of seconds and audio is present.",
      "The point list is below the video.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "match-idle-controls",
    area: "match",
    title: "The idle video is our design, and native controls take over on play",
    why: "Before playback the browser paints its own play button and scrubber across the picture, and on iOS an expand icon lands exactly where a title wants to be. So the idle state is designed, and the browser's controls only appear once playback starts.",
    steps: [
      "Open a match without pressing play.",
      "Then press play and look at the video again.",
    ],
    expected: [
      "Idle, the picture is clean apart from our own play affordance.",
      "Once playing, the browser's controls appear and our overlays get out of the way.",
      "Nothing of ours sits on top of the scrubber along the bottom edge.",
    ],
    surfaces: PHONE,
    depth: "core",
  },
  {
    id: "match-point-list",
    area: "match",
    title: "The point list shows every point with its clip",
    why: "The point list is the index to the match. A missing or unplayable clip makes the point unreviewable.",
    needs: ["A processed match with points"],
    steps: ["Scroll the whole point list.", "Open several points spread across the match."],
    expected: [
      "Every point has a thumbnail and a duration.",
      "Every point opens and plays.",
      "The numbering runs in order with no gaps.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "match-seek",
    area: "match",
    title: "Seeking inside a clip works and does not restart it",
    why: "Video files have to be written so a player can jump without downloading everything first. When that goes wrong, dragging the scrubber silently restarts the clip.",
    needs: ["A processed match"],
    steps: [
      "Play a point clip and drag the scrubber to the middle.",
      "Do the same on the full cut video.",
      "Jump backwards and forwards several times.",
    ],
    expected: [
      "Playback continues from where you dropped it.",
      "The clip does not jump back to the start.",
      "Seeking is quick rather than stalling for seconds.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "match-fullscreen-rotate",
    area: "match",
    title: "Fullscreen on a phone survives rotation",
    why: "This area has broken repeatedly. On iOS the whole fullscreen view rotates, which moves every overlay with it, so controls can end up off screen or in the wrong corner.",
    needs: ["A processed match"],
    steps: [
      "Play a point clip and enter fullscreen.",
      "Rotate the phone to landscape and back to portrait.",
      "Try every control while fullscreen in both orientations.",
    ],
    expected: [
      "The video fills the screen in both orientations.",
      "Every control stays on screen and in a sensible place.",
      "Leaving fullscreen returns you to the same point, still at the same moment.",
    ],
    surfaces: PHONE,
    depth: "core",
  },
  {
    id: "match-one-video-at-a-time",
    area: "match",
    title: "Only one video ever plays at a time",
    why: "The phone and desktop layouts are both present in the page, with one hidden. A tap that starts the hidden one gives you two soundtracks at once from a single press.",
    steps: [
      "Play the cut video, then open a point and play its clip.",
      "Listen carefully for a second soundtrack.",
      "Close the point and go back to the match.",
    ],
    expected: [
      "Starting one video stops the other.",
      "You never hear two at once.",
      "Leaving a point stops its clip rather than leaving it playing.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "match-leave-stops-audio",
    area: "match",
    title: "Navigating away stops the sound",
    why: "A video element removed from the page keeps playing with audio unless it is explicitly stopped. The symptom is music from a page you have already left.",
    steps: [
      "Start a clip playing.",
      "Use the bottom bar to move to Journal without pausing first.",
    ],
    expected: ["The sound stops immediately on leaving."],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "match-speed",
    area: "match",
    title: "Playback speed changes and sticks",
    why: "Slow motion is how a coach looks at contact and a fast pass is how a player skims. A speed that resets on every clip makes both useless.",
    steps: ["Open a point, set a slower speed.", "Move to the next point."],
    expected: [
      "The clip plays at the chosen speed.",
      "The speed carries to the next clip rather than resetting.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "match-next-point",
    area: "match",
    title: "Moving to the next point works from inside a point",
    why: "Review is a sequence, not a set of visits to a list. Anything that forces a return to the list between points makes reviewing a match tedious enough to stop.",
    steps: ["Open a point and use the next control repeatedly."],
    expected: [
      "Each press moves to the following point and starts its clip.",
      "The control is not offered on the last point, or does nothing harmful there.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "match-opponent-edit",
    area: "match",
    title: "The opponent name and venue can be edited afterwards",
    why: "People upload first and label later. The name is what the match is called everywhere else, so the edit has to propagate.",
    steps: ["Edit the opponent name on the match.", "Return to the library."],
    expected: [
      "The new name shows on the match page and on the library card.",
      "It survives a page reload.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "match-tags",
    area: "match",
    title: "Tags can be created and applied to points",
    why: "Tags are how a player collects every point of one kind across a match, for example every serve return that went long.",
    steps: [
      "Open a point and add a new tag.",
      "Apply the same tag to two more points.",
      "Filter or view by that tag.",
    ],
    expected: [
      "The tag is created once and offered again on later points.",
      "All three tagged points are found together.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "match-export",
    area: "match",
    title: "The export options each produce the right video",
    why: "Three different things can be downloaded and they are easy to confuse: the full match (the cut, with dead time gone), the starred rallies in order, and the original uncut upload. Include score adds the running score to a rendered file and applies to whichever export is chosen.",
    needs: ["A match with some starred points"],
    steps: [
      "Open Export from Tools.",
      "Download Full match, then Starred points, then the original.",
    ],
    expected: [
      "Full match is the cut, with dead time gone.",
      "Starred points contains only starred rallies, in match order.",
      "The original is the upload, uncut.",
      "Each file plays after downloading.",
    ],
    surfaces: WEB,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-export-score",
    area: "match",
    title: "An export with the score included shows the right score",
    why: "The scoreboard on an exported video is built from the points you confirmed, so it is only as right as the scoring. A wrong score on a video someone posts publicly is the worst place for this to be wrong.",
    needs: ["A fully scored match"],
    steps: ["Export the match with the score included.", "Watch the result."],
    expected: [
      "The scoreboard advances in step with the points.",
      "The final score matches the scorecard in the app.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "match-delete",
    area: "match",
    title: "Deleting a match removes it and asks first",
    why: "Deletion frees storage and cannot be undone, so it must be deliberate and it must actually happen.",
    steps: ["Delete a match you do not need.", "Return to the library and reload."],
    expected: [
      "A confirmation is required.",
      "The match is gone from the library after a reload.",
      "Storage used in Account drops accordingly.",
    ],
    surfaces: ALL,
    depth: "core",
  },

  // -------------------------------------------------------------------------
  // Scoring
  // -------------------------------------------------------------------------
  {
    id: "scoring-keep-score",
    area: "scoring",
    title: "Scoring a match point by point works start to finish",
    why: "The points play one after another and you say who won each. A full match should take about ten minutes, and everything downstream, the stats, the pressure points and the scoreboard, is built from these answers.",
    needs: ["A processed match with points, unscored"],
    steps: [
      "Start scoring from the match page.",
      "Answer who won for every point to the end.",
    ],
    expected: [
      "Each clip plays and then asks who won.",
      "The running score updates as you go.",
      "Finishing returns you to the match with the score in place.",
      "Back in the library, the card shows GAMES won, not points. It stays 0-0 until somebody actually finishes a game, which takes 11 points with two clear, so scoring five points and seeing 0-0 is correct.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "scoring-first-server",
    area: "scoring",
    title: "The app asks who served first, once",
    why: "Nothing in the video tells the software who served. It asks you once and then works out every later server from the rotation, so this single answer decides the server shown on every point in the match.",
    needs: ["An unscored match"],
    steps: ["Start scoring and answer the first-server question."],
    expected: [
      "The question is asked once at the start.",
      "It is not asked again later in the same match.",
      "The answer can be corrected afterwards.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "scoring-serve-rotation",
    area: "scoring",
    title: "The server alternates every two points, and every point at deuce",
    why: "Table tennis serves change every two points. Once the score reaches ten all, the serve changes every single point. If the app keeps alternating every two after ten all, every server label past that is wrong.",
    needs: ["A scored match that reached ten all in at least one game"],
    steps: [
      "Score a game past ten all.",
      "Step through the points and read the server on each.",
    ],
    expected: [
      "Up to ten all the server changes every two points.",
      "From ten all it changes on every point.",
      "The server shown matches who actually serves in the clip.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "scoring-game-to-eleven",
    area: "scoring",
    title: "A game ends at eleven with two clear",
    why: "A game goes to eleven, but only if the winner is two points clear. At ten all it continues until someone leads by two, so a game can finish twelve ten, thirteen eleven and so on.",
    needs: ["A match with a game that went past ten all"],
    steps: ["Score a match containing a deuce game.", "Read the game scores."],
    expected: [
      "No game ends at eleven ten.",
      "Deuce games end with a two point gap.",
      "The next game starts from zero zero.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "scoring-game-boundary",
    area: "scoring",
    title: "A game boundary can be set and corrected by hand",
    why: "The software does not know where a game ended. You tell it, and everything about games and the match result follows from that.",
    needs: ["A scored match of more than one game"],
    steps: [
      "Mark the end of a game at the correct point.",
      "Then move it one point earlier and check what changes.",
    ],
    expected: [
      "The game scores recalculate immediately.",
      "The match result changes to match.",
      "The correction survives a reload.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "scoring-correction",
    area: "scoring",
    title: "A point scored wrongly can be changed",
    why: "Scoring is fast and mistakes happen. If a wrong answer cannot be corrected, the player has to rescore the match or live with wrong stats.",
    needs: ["A scored match"],
    steps: ["Open a scored point and change who won it."],
    expected: [
      "The change is accepted.",
      "The running score and everything derived from it update.",
      "The change survives a reload.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "scoring-partial",
    area: "scoring",
    title: "A partly scored match is still usable",
    why: "Scoring is optional by design. A match with no confirmations at all is meant to be fully usable, and a half scored one must not show a misleading score.",
    needs: ["A match with only some points scored"],
    steps: ["Score five points of a match and leave the rest.", "Return to the match page."],
    expected: [
      "The video and points work normally.",
      "Any score shown is clearly based only on what you confirmed.",
      "No invented score appears for the unscored points.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "scoring-resume",
    area: "scoring",
    title: "Scoring resumes where you left off",
    why: "Ten minutes of scoring is long enough to be interrupted. Starting over from point one is how someone abandons the task.",
    needs: ["A partly scored match"],
    steps: [
      "Score part of a match, leave the page.",
      "Come back and start scoring again.",
    ],
    expected: ["Scoring resumes at the first unscored point, not at the beginning."],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "scoring-how-it-ended",
    area: "scoring",
    title: "Recording how a point ended is optional and saved",
    why: "The reason a point ended feeds the tactical breakdown. It is optional on purpose, because forcing it would double how long scoring takes.",
    needs: ["A match being scored"],
    steps: [
      "On one point, record how it ended.",
      "On the next, skip that question.",
    ],
    expected: [
      "Skipping is possible and moves on.",
      "The recorded reason appears on the point afterwards.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "scoring-keyboard",
    area: "scoring",
    title: "Scoring by keyboard works on a desktop",
    why: "Scoring a whole match with a mouse is slow. Keys are what make ten minutes possible.",
    needs: ["An unscored match"],
    steps: ["Score a run of points using only the keyboard."],
    expected: [
      "Keys answer who won and advance to the next point.",
      "No key press scrolls the page instead of scoring.",
    ],
    surfaces: WEB_DESKTOP,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------------
  {
    id: "placement-generated",
    area: "placement",
    title: "Placement maps appear when they were switched on at upload",
    why: "Placement is off by default because it costs extra processing. A match uploaded without it will never have maps, and that is correct rather than a bug. Since August 2026 the maps show serves only: fewer dots that are almost always right, rather than every bounce.",
    needs: ["A match uploaded with placement maps switched on"],
    steps: ["Open a point in that match and find the placement view."],
    expected: [
      "A map of where serves landed is shown, and it is labelled as serve placement.",
      "A match uploaded without placement shows no maps and does not pretend to.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "placement-plausible",
    area: "placement",
    title: "The marks on the map match the serves in the clips",
    why: "A placement map is a claim about where a serve bounced. The maps show serves only, so watch the serve at the start of a rally and check the claim, because a plausible looking map that is wrong is worse than no map.",
    needs: ["A match with placement maps"],
    steps: [
      "Watch the serve of a point closely and note which half and which side it landed on.",
      "Compare with the map for that point.",
    ],
    expected: [
      "The serve's mark falls on the correct half and the correct side of the table.",
      "A rally whose serve could not be placed has no mark rather than a guessed one.",
    ],
    surfaces: WEB,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "placement-aggregate",
    area: "placement",
    title: "The match level placement view combines the points",
    why: "One rally says nothing. The pattern across a match is the reason placement exists, so the aggregate has to reflect the points beneath it.",
    needs: ["A match with placement maps"],
    steps: ["Open the match level placement view."],
    expected: [
      "It shows more marks than any single point.",
      "Filters, if any, change what is shown.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "placement-report-wrong",
    area: "placement",
    title: "A wrong placement can be reported from the point",
    why: "Placement accuracy is improved from reports tied to a specific point, so the feedback path from the map itself is the one that produces usable evidence.",
    needs: ["A match with placement maps"],
    steps: ["Find a point whose map looks wrong and use the report control."],
    expected: [
      "A report can be submitted against that specific point.",
      "It is acknowledged on screen.",
    ],
    surfaces: ALL,
    depth: "edge",
  },
  {
    id: "placement-missing-gracefully",
    area: "placement",
    title: "A point with no placement data says so quietly",
    why: "Placement can fail for one point while working for the rest, for example when the table is out of frame. That point should be blank, not broken.",
    needs: ["A match with placement maps"],
    steps: ["Look for a point with no marks and open it."],
    expected: [
      "The point opens normally and the clip plays.",
      "The empty map is handled with a short line rather than an error.",
    ],
    surfaces: WEB,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Notes and voice
  // -------------------------------------------------------------------------
  {
    id: "notes-point-note",
    area: "notes",
    title: "A note can be written on a point and comes back",
    why: "Notes on points are the working surface between a player and a coach, and they are the reason to come back to a match weeks later.",
    needs: ["A processed match"],
    steps: ["Open a point, write a note, save.", "Leave and reopen the point."],
    expected: [
      "The note is there after reopening.",
      "The point shows an indicator that it carries a note.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "notes-match-note",
    area: "notes",
    title: "A note can be written about the whole match",
    why: "Some observations are about the match rather than one rally, and they should not have to be attached to an arbitrary point.",
    needs: ["A processed match"],
    steps: ["Write an overall note on the match.", "Reload."],
    expected: ["The note persists and is clearly about the match, not a point."],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "notes-voice",
    area: "notes",
    title: "A voice note records, transcribes and can be corrected",
    why: "Talking is faster than typing on a phone at a table. The recording is kept and the transcript is editable, because transcription is never perfect.",
    needs: ["A processed match, and a device with a microphone"],
    steps: [
      "Record a voice note on a point.",
      "Wait for the transcript.",
      "Edit a word in the transcript and save.",
    ],
    expected: [
      "Recording starts and stops cleanly with clear state on screen.",
      "A transcript appears within a reasonable time.",
      "The edited transcript persists.",
      "The audio can be played back.",
    ],
    surfaces: PHONE,
    depth: "core",
  },
  {
    id: "notes-mic-denied",
    area: "notes",
    title: "Refusing microphone permission is handled",
    why: "People deny the prompt by accident. The app should say what happened rather than appearing to record nothing.",
    steps: ["Deny microphone access, then try to record a voice note."],
    expected: [
      "A message explains the microphone is unavailable.",
      "Typing a note still works.",
    ],
    surfaces: PHONE,
    depth: "edge",
  },
  {
    id: "notes-edit-delete",
    area: "notes",
    title: "A note can be edited and deleted",
    why: "Notes are personal and often written quickly. Being unable to fix or remove one is a small trap that erodes trust in writing anything.",
    needs: ["An existing note"],
    steps: ["Edit a note and save.", "Delete another note."],
    expected: [
      "The edit persists after a reload.",
      "The deleted note is gone and its indicator disappears from the point.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "notes-annotated-frame",
    area: "notes",
    title: "A frame can be marked up and attached to a note",
    why: "Position is easier to point at than to describe, which is why a still from the clip can be drawn on and kept with the note.",
    needs: ["A processed match"],
    steps: ["From a point, capture a frame, draw on it, attach it to a note."],
    expected: [
      "The drawing appears on the saved note.",
      "It survives a reload and opens at full size.",
    ],
    surfaces: ALL,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Journal
  // -------------------------------------------------------------------------
  {
    id: "journal-feed",
    area: "journal",
    title: "The journal has four tabs: All, Matches, Notes and From Coaches",
    why: "Everything a player writes lands in one place, split only by where it came from: notes written on matches, notes written by hand, and what coaches have shared. Recollect appears as a fifth tab only while it is switched on in Account. A note written on a point that never reaches the journal is effectively lost.",
    needs: ["At least one match note"],
    steps: ["Open Journal.", "Tap each tab in turn."],
    expected: [
      "All shows everything. Matches shows only notes written on matches, each saying which match and linking back to it.",
      "Notes shows the entries written by hand.",
      "From Coaches shows what coaches have shared, and says so in one short line when nothing has.",
    ],
    surfaces: ALL,
    depth: "smoke",
    added: "2026-09-08",
  },
  {
    id: "journal-new-entry",
    area: "journal",
    title: "A note can be written from scratch, and Improve with AI tidies a rough one",
    why: "Not everything worth recording comes from a video. A note no longer asks whether it is practice or a lesson; it is one kind of note. Improve with AI rewrites rough or dictated text into clean sentences without changing what was said.",
    steps: [
      "Create a new note, write a few rough sentences, save.",
      "Reopen it, choose Improve with AI, save again.",
      "Reload the journal.",
    ],
    expected: [
      "The note appears in the feed and opens with its text intact.",
      "After improving, the text reads cleanly and still says the same things.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "journal-lesson",
    area: "journal",
    title: "A note that names a coach is broken into takeaways",
    why: "A coaching session produces several separate points to work on. A note long enough to hold them is read into short grouped takeaways, with the original text one tap away, so each point can be revisited on its own.",
    steps: [
      "Write a note of a few paragraphs about a lesson and pick the coach it was with.",
      "Save, wait a moment, and reopen it.",
    ],
    expected: [
      "The note carries the coach's name.",
      "Its takeaways are listed separately rather than as one paragraph, and Transcript shows the original text.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "journal-photo",
    area: "journal",
    title: "A photo of handwritten notes can be attached and read",
    why: "Plenty of players write on paper at the table. Photographing the page is how that gets into the journal.",
    steps: ["Attach a photo of some handwriting to an entry.", "Save and reopen."],
    expected: [
      "The photo is attached and opens.",
      "If text is offered from the image, it is roughly right and editable.",
    ],
    surfaces: PHONE,
    depth: "edge",
  },
  {
    id: "journal-search",
    area: "journal",
    title: "Search filters the journal as you type",
    why: "Search filters instantly and for free. Asking a question of the journal is a separate, deliberate action, so typing alone must never trigger it.",
    needs: ["Several journal entries"],
    steps: ["Type a word you know appears in one entry."],
    expected: [
      "The list filters as you type.",
      "Nothing is sent anywhere until you deliberately ask a question.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "journal-ask",
    area: "journal",
    title: "Asking a question of the journal answers from your own entries",
    why: "The answer must come from what you wrote. An answer that invents advice you never recorded is the failure that matters here.",
    needs: ["Several journal entries"],
    steps: ["Type a question and choose to ask it.", "Read the answer."],
    expected: [
      "The answer draws on your entries and points at them.",
      "The filtered list underneath is not disturbed by asking.",
      "Asking repeatedly eventually hits a limit and says so plainly.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "journal-working-on",
    area: "journal",
    title: "A cue can be added to Working on and cleared later",
    why: "Working on is the short list a player carries into the next session. A list that grows forever stops being read.",
    steps: ["Add a cue.", "Add the same cue again.", "Remove it."],
    expected: [
      "The cue appears on the list.",
      "Adding a duplicate is refused with a short message.",
      "Removing it takes it off the list.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "journal-recollect",
    area: "journal",
    title: "Recollect brings back an old entry to re-read",
    why: "The value of a journal is in re-reading it. Recollect surfaces something you wrote a while ago and lets you promote it back onto Working on.",
    needs: ["Journal entries older than a few days"],
    steps: ["Open Recollect.", "Reveal a card and add it to Working on.", "Dismiss another."],
    expected: [
      "A card can be revealed.",
      "Adding it puts it on Working on, and says so if it is already there.",
      "A dismissed card does not come straight back.",
    ],
    surfaces: ALL,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // My game
  // -------------------------------------------------------------------------
  {
    id: "stats-appears",
    area: "stats",
    title: "My game appears once enough matches are fully scored",
    why: "Stats are built only from points a player confirmed, and they stay hidden until there are enough of them. Showing a win rate from two scored points would be worse than showing nothing.",
    needs: ["Three fully scored matches"],
    steps: ["Open My game."],
    expected: [
      "The sections render with real numbers.",
      "With fewer scored matches, the section is absent rather than empty.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "stats-match-arithmetic",
    area: "stats",
    title: "The headline numbers agree with the matches they come from",
    why: "Every number here is derived from scoring. If points won does not equal what you actually confirmed, everything downstream is wrong too.",
    needs: ["Fully scored matches"],
    steps: [
      "Note points won and matches played on My game.",
      "Add up the same figures from the individual matches.",
    ],
    expected: ["The totals match. No off-by-one, no double counting."],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "stats-serve-split",
    area: "stats",
    title: "Serving and receiving are split correctly",
    why: "Winning on your own serve and winning on the opponent's are different skills, and the split depends entirely on the serve rotation being right.",
    needs: ["Fully scored matches"],
    steps: ["Read the serving and receiving sections."],
    expected: [
      "Serve and receive points add up to the total points.",
      "The split is consistent with the servers shown on individual points.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "stats-tactics",
    area: "stats",
    title: "The tactical view reflects the reasons recorded during scoring",
    why: "This section is built from how points ended, which is optional. It should only describe points where a reason was actually recorded.",
    needs: ["A match scored with reasons recorded"],
    steps: ["Open the tactical view."],
    expected: [
      "The reasons shown are ones you recorded.",
      "Points with no reason are not silently counted as one.",
    ],
    surfaces: WEB,
    depth: "edge",
  },
  {
    id: "stats-opponents",
    area: "stats",
    title: "Results are grouped by opponent",
    why: "Playing the same person repeatedly is normal in a club, and the record against each one is the reason to name opponents at upload.",
    needs: ["Scored matches against at least two opponents"],
    steps: ["Open the opponents view."],
    expected: [
      "Each opponent is listed once with a record.",
      "The same name is not split across two rows by capitalisation or spacing.",
    ],
    surfaces: WEB,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Sharing and coach access
  // -------------------------------------------------------------------------
  {
    id: "sharing-point-link",
    area: "sharing",
    title: "A single point can be shared and opens signed out",
    why: "Share links are the only place logged-out visitors ever see match footage, so what they expose is deliberately narrow: the clip and nothing else.",
    needs: ["A processed match"],
    steps: [
      "Share one point and copy the link.",
      "Open it in a private window with no session.",
    ],
    expected: [
      "The clip plays for a signed-out visitor.",
      "No notes, no scorecard and no placement maps are visible.",
      "There is no way to reach the rest of the account from that page.",
    ],
    surfaces: ALL,
    depth: "smoke",
  },
  {
    id: "sharing-match-link",
    area: "sharing",
    title: "A whole match can be shared as the cut video only",
    why: "Sharing a match shares the playtime video, not the point-by-point breakdown. The breakdown is working material and stays private.",
    needs: ["A processed match"],
    steps: ["Share the match and open the link signed out."],
    expected: [
      "The cut video plays.",
      "No point list appears.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "sharing-starred-link",
    area: "sharing",
    title: "A starred link follows what is currently starred",
    why: "A starred share is resolved when it is viewed, not when it is made. Starring another point later changes what an already-sent link shows, which is the intended behaviour and surprising if you do not know it.",
    needs: ["A match with starred points"],
    steps: [
      "Share your starred points and open the link.",
      "Star another point in the app.",
      "Reload the shared link.",
    ],
    expected: ["The newly starred point now appears in the shared view."],
    surfaces: WEB,
    depth: "edge",
  },
  {
    id: "sharing-revoke",
    area: "sharing",
    title: "Revoking a share link really turns it off",
    why: "This is a privacy promise. A revoked link must stop working everywhere, including for someone who already has it open.",
    needs: ["An existing share link"],
    steps: [
      "Open a share link and leave it open.",
      "Revoke it in the app.",
      "Reload the shared page.",
    ],
    expected: [
      "The page no longer shows the video.",
      "It says the link is off rather than showing an error.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "sharing-unknown-token",
    area: "sharing",
    title: "A made-up share link is indistinguishable from a revoked one",
    why: "If a wrong token said not found and a revoked one said turned off, the difference would tell a stranger which links exist.",
    steps: ["Open a share URL with random characters in place of the token."],
    expected: ["The same minimal page appears as for a revoked link."],
    surfaces: WEB,
    depth: "edge",
  },
  {
    id: "sharing-coach-invite",
    area: "sharing",
    title: "A coach invite can be created and accepted",
    why: "Coach access is granted by the player and can be scoped to one match or to everything. The coach signs in as a normal user; the link is what creates the relationship, the same one a coach's own roster invite creates from the other side. Since September 2026 the invite page names the account that is about to accept and accepts on a tap, never on arrival.",
    needs: ["A second account to act as the coach"],
    steps: [
      "Create a coach invite from the Coach row in a match's Tools.",
      "Open it in another browser and sign in as the second account.",
      "Read the page, then press Accept.",
    ],
    expected: [
      "The page says which account is signed in before anything is accepted.",
      "After Accept the player appears in the coach's app, and the coach can open the matches that were shared.",
    ],
    surfaces: WEB,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "sharing-coach-notes",
    area: "sharing",
    title: "A coach can leave notes but cannot change the player's data",
    why: "A coach is a guest. They can add their own notes and read everything shared with them, and they must not be able to edit the player's scoring, names or notes.",
    needs: ["An accepted coach link"],
    steps: [
      "As the coach, open a shared match and leave a note on a point.",
      "Try to edit the player's own note, the opponent name, and the scoring.",
      "Sign back in as the player.",
    ],
    expected: [
      "The coach's note saves and is visibly a coach's note.",
      "None of the player's own data can be changed by the coach.",
      "The player sees the coach's note and gets a notification about it.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "sharing-revoke-coach",
    area: "sharing",
    title: "Revoking coach access removes their view",
    why: "Coaching relationships end. Access granted until revoked has to actually end on revocation.",
    needs: ["An accepted coach link"],
    steps: ["Revoke the coach's access.", "As the coach, reload the shared match."],
    expected: [
      "The coach can no longer open the match.",
      "The player disappears from the coach's list.",
      "Notes the coach already wrote remain visible to the player.",
    ],
    surfaces: WEB,
    depth: "core",
  },

  // -------------------------------------------------------------------------
  // Coach side
  // -------------------------------------------------------------------------
  {
    id: "coaching-storefront-public",
    area: "coaching",
    title: "A published coach page opens signed out",
    why: "A coach's page is what they paste into a message to a prospective student, so it has to work for someone with no account.",
    needs: ["A published coach handle"],
    steps: ["Open a coach page signed out.", "Read the offerings and the profile."],
    expected: [
      "The page renders with the coach's name, photo and offerings.",
      "Prices and turnaround times are shown.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "coaching-unpublished-hidden",
    area: "coaching",
    title: "An unpublished or unknown handle shows nothing",
    why: "A draft coach page must not be reachable by guessing the URL, and it should look exactly like a handle that was never registered.",
    steps: [
      "Open a coach URL for a handle that does not exist.",
      "Open one that exists but is not published.",
    ],
    expected: ["Both show the same not-found response."],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "coaching-setup",
    area: "coaching",
    title: "A coach can set up a page from scratch",
    why: "This is the first thing a coach ever does, and it decides whether they continue. It should be possible to get to a publishable page in one sitting.",
    needs: ["An account with no coach profile"],
    steps: [
      "Start coach setup.",
      "Fill in name, headline and bio, add a photo.",
      "Publish.",
    ],
    expected: [
      "Each step saves.",
      "The public page reflects what was entered.",
      "Publishing is a deliberate action, not automatic.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "coaching-offering-create",
    area: "coaching",
    title: "A coach can create an offering with a price and turnaround",
    why: "The offering is the product being sold. The coach sets the price, the scope and the turnaround, so all three must save exactly as entered.",
    needs: ["A coach profile"],
    steps: [
      "Create an offering with a title, description, price and turnaround.",
      "Save and open the public page.",
    ],
    expected: [
      "The offering appears publicly with the exact price entered.",
      "The turnaround shown matches what was set.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "coaching-offering-edit",
    area: "coaching",
    title: "An offering can be edited, hidden and reordered",
    why: "Coaches change their prices. A hidden offering must stop being buyable immediately, not just stop being shown.",
    needs: ["An existing offering"],
    steps: [
      "Change the price and save.",
      "Hide the offering and reload the public page.",
    ],
    expected: [
      "The new price shows publicly.",
      "The hidden offering is gone from the public page and cannot be bought.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "coaching-image-upload",
    area: "coaching",
    title: "Offering and profile images upload and display",
    why: "Images are uploaded through our own server rather than straight to storage, so failures here look like server errors rather than browser ones.",
    needs: ["A coach profile"],
    steps: ["Upload a card image on an offering.", "Change the profile photo."],
    expected: [
      "Both upload and appear without a reload.",
      "Both appear on the public page.",
      "A file that is too large is refused with a readable message.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "coaching-payouts-state",
    area: "coaching",
    title: "A coach who has not finished payouts cannot take orders",
    why: "Taking money for a coach who cannot be paid creates a refund and an apology. The page should push them to finish setup instead.",
    needs: ["A coach profile without payouts set up"],
    steps: ["Look at the coaching hub for that coach.", "Open their public page."],
    expected: [
      "The hub says payouts are unfinished and offers the next step.",
      "The public page does not offer a working buy button.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "coaching-pause",
    area: "coaching",
    title: "A coach can pause new orders",
    why: "Coaches go on holiday. Pausing has to stop new orders while leaving work in progress alone.",
    needs: ["A coach accepting orders"],
    steps: ["Turn off accepting orders.", "Open the public page."],
    expected: [
      "The page no longer offers a purchase.",
      "Orders already in flight are unaffected.",
    ],
    surfaces: WEB,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Paid reviews
  // -------------------------------------------------------------------------
  {
    id: "orders-buy",
    area: "orders",
    title: "A review can be bought in test mode",
    why: "Your account is pinned to test billing, so every payment you make uses test card details and no real money moves. A live coach's page is deliberately unbuyable from a test account, and the other way round.",
    needs: [
      "The QA coach storefront at /coach/qacoach, which only QA accounts can see",
    ],
    steps: [
      "Open /coach/qacoach and buy the test offering.",
      "Complete the test checkout.",
    ],
    expected: [
      "Checkout completes and the order appears under your reviews.",
      "The order is visibly a test order.",
      "No real charge appears anywhere.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "orders-submit-match",
    area: "orders",
    title: "A bought review is completed by submitting a match",
    why: "Paying and submitting are separate steps. The coach cannot start until the student picks the match and answers the intake questions.",
    needs: ["A paid order awaiting submission"],
    steps: [
      "Open the order and pick a match.",
      "Answer the intake questions and send it.",
    ],
    expected: [
      "The order moves to a submitted state.",
      "The coach sees it in their queue.",
      "The match is viewable by the coach.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "orders-coach-delivers",
    area: "orders",
    title: "A coach can write and deliver a review",
    why: "The written review is the thing being sold. It is organised into the sections the offering promised, and delivering it is what starts the student's clock to respond.",
    needs: ["A submitted order"],
    steps: [
      "As the coach, open the order and write each section.",
      "Deliver it.",
    ],
    expected: [
      "Sections save as you go and survive a reload before delivery.",
      "Delivering notifies the student.",
      "The student can read every section.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "orders-clarification",
    area: "orders",
    title: "A coach can ask the student a question mid-review",
    why: "A coach often cannot review footage without knowing something, for example which player the student is. The order pauses on them rather than being delivered wrong.",
    needs: ["An order in review"],
    steps: [
      "As the coach, request a clarification.",
      "As the student, answer it.",
    ],
    expected: [
      "The student is notified and can reply.",
      "The coach sees the answer and can continue.",
    ],
    surfaces: WEB,
    depth: "edge",
  },
  {
    id: "orders-complete",
    area: "orders",
    title: "A delivered review can be completed by the student",
    why: "Completion is what releases the coach's share, so it is the end of the money path as well as the conversation.",
    needs: ["A delivered order"],
    steps: ["As the student, read the review and complete the order."],
    expected: [
      "The order moves to completed.",
      "The coach sees it as completed.",
      "The student can still read the review afterwards.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "orders-decline",
    area: "orders",
    title: "A coach can decline an order and the student is refunded",
    why: "A coach may not be able to review a particular match. Declining has to return the money and say why.",
    needs: ["A submitted order"],
    steps: ["As the coach, decline with a message.", "As the student, open the order."],
    expected: [
      "The student sees it declined with the coach's message.",
      "The refund is reflected on the order.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "orders-cancel",
    area: "orders",
    title: "A student can cancel before the coach starts",
    why: "Cancelling is allowed right up until the coach begins work, and not after. The boundary is the thing to check.",
    needs: ["An order awaiting submission"],
    steps: [
      "Cancel an order the coach has not started.",
      "Then try to cancel one the coach has started.",
    ],
    expected: [
      "The first cancels and refunds.",
      "The second does not offer cancellation.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "orders-student-list",
    area: "orders",
    title: "Your reviews lists every order with the right status wording",
    why: "The internal state names are not shown to people. Each state has plain wording, and it differs for the student and the coach looking at the same order.",
    needs: ["At least one order"],
    steps: ["Open your reviews as the student.", "Open the same order as the coach."],
    expected: [
      "Both see a plain description of the state.",
      "No internal state name such as awaiting_submission is shown.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "orders-cross-mode-blocked",
    area: "orders",
    title: "A test account cannot buy from a live coach",
    why: "This is the wall that keeps fake money out of real coaches' inboxes. From a test account a live coach's offering should simply not exist, and the refusal deliberately says not found rather than explaining itself.",
    steps: ["Signed in as the QA account, open a live coach's page and try to buy."],
    expected: [
      "The purchase does not go through.",
      "The message is a plain not-found rather than an error about billing modes.",
      "No order row is created.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "orders-own-offering",
    area: "orders",
    title: "A coach cannot buy their own offering",
    why: "It would create an order that pays the platform fee to take money from itself, and it is the most obvious thing to try.",
    needs: ["A coach account with an offering"],
    steps: ["Signed in as the coach, try to buy your own offering."],
    expected: ["The purchase is refused."],
    surfaces: WEB,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Account, storage and minutes
  // -------------------------------------------------------------------------
  {
    id: "account-storage-figure",
    area: "account",
    title: "Storage used reflects what is actually stored",
    why: "Storage is a real cost and a real limit. The figure should move when a match is added or deleted, or the limit means nothing.",
    steps: [
      "Note the storage figure in Account.",
      "Delete a match, then reload Account.",
    ],
    expected: [
      "The figure drops after the deletion.",
      "The limit shown matches what uploads actually enforce.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "account-minutes-figure",
    area: "account",
    title: "Processing minutes count down as matches are processed",
    why: "Minutes pay for the vision pipeline and are charged against the length of the source video. A balance that never moves means nothing is being metered.",
    steps: [
      "Note your minutes balance.",
      "Process a match of a known length.",
      "Reload Account.",
    ],
    expected: [
      "The balance drops by roughly the length of the source video.",
      "The balance never goes below zero.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "account-profile-edit",
    area: "account",
    title: "The player profile can be edited and is used elsewhere",
    why: "Handedness, grip and rubbers are what a coach reads before watching. They are entered at onboarding and must remain editable.",
    steps: ["Change your handedness and rubbers.", "Reload."],
    expected: ["The changes persist."],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "account-links",
    area: "account",
    title: "Every row on the Account page goes where it says",
    why: "Account is a hub of links to everything peripheral, and a dead link here is invisible until someone needs it.",
    steps: ["Follow every row on the Account page in turn, returning each time."],
    expected: [
      "Every row opens the page it names.",
      "Nothing 404s and nothing loops back to Account.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "account-packs",
    area: "account",
    title: "Storage and minutes can be requested for free while PongLens is in beta",
    why: "Purchases are not switched on. Instead the storage and minutes sections say PongLens is in beta and offer a free allowance increase, sent as a request the owner approves. Nothing in these sections may look like a price.",
    steps: [
      "Open the storage and minutes sections in Account.",
      "Send a request for more storage.",
    ],
    expected: [
      "Each section says PongLens is in beta and offers a request, with no packs and no prices.",
      "The request sends and the section confirms it calmly. A second request is not offered while one is waiting.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "account-support-link",
    area: "account",
    title: "The support address works",
    why: "Support mail goes to a real mailbox that a human reads. If the address bounces, complaints go nowhere.",
    steps: ["Find the support address on the Account page and send a short message."],
    expected: [
      "The address is on the ponglens.com domain.",
      "The message does not bounce.",
    ],
    surfaces: WEB,
    depth: "edge",
  },
  {
    id: "account-delete",
    area: "account",
    title: "Account deletion is explained and guarded",
    why: "This is the most destructive control in the product and it sits at the bottom of the settings list. It must require a deliberate confirmation.",
    steps: ["Open the delete option and read it, without confirming."],
    expected: [
      "It explains what will be removed.",
      "It requires a deliberate confirmation step.",
      "Backing out leaves the account untouched.",
    ],
    surfaces: WEB,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Email
  // -------------------------------------------------------------------------
  {
    id: "email-from-and-reply",
    area: "email",
    title: "Product email comes from the right address and can be replied to",
    why: "Mail is sent by one service and read in another. Every transactional message carries a reply-to pointing at the support mailbox, so a reply reaches a human.",
    needs: ["Any product email"],
    steps: ["Open a product email and inspect the sender and reply-to."],
    expected: [
      "The sender is a ponglens.com address.",
      "Replying addresses the support mailbox.",
      "A reply is actually received.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "email-renders",
    area: "email",
    title: "Emails render properly in a real mail client",
    why: "Mail clients strip and rearrange things a browser would not. Checking on a phone is the important half, because that is where most mail is read.",
    needs: ["Any product email"],
    steps: ["Open the same email on a phone mail app and on desktop webmail."],
    expected: [
      "The logo and layout render in both.",
      "Nothing overflows the width on a phone.",
      "Every link works.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "email-match-ready",
    area: "email",
    title: "The match ready email names the right match",
    why: "People upload several matches in a session. An email that names the wrong one sends them to the wrong footage.",
    steps: ["Upload two matches close together and wait for both emails."],
    expected: [
      "Two emails arrive, each naming its own match.",
      "Each link opens the match it names.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "email-coach-note",
    area: "email",
    title: "A coach note produces a notification for the player",
    why: "The point of coach access is the exchange. If the player is not told, the note sits unread.",
    needs: ["An accepted coach link"],
    steps: ["As the coach, leave a note.", "As the player, check the bell."],
    expected: [
      "A notification appears naming the coach and the match.",
      "Opening it goes to that point.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "email-no-duplicates",
    area: "email",
    title: "One event produces one email",
    why: "Duplicate mail is how a sender's reputation gets damaged, and it usually comes from a job being retried.",
    steps: ["Watch the inbox for a day of normal testing."],
    expected: ["No event produces the same email twice."],
    surfaces: WEB,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Feedback board
  //
  // The surface every player can reach to tell us something is wrong, and
  // the one your own reports deliberately stay off. Both halves need
  // testing, and the second half needs a second account to test at all.
  // -------------------------------------------------------------------------
  {
    id: "feedback-file-as-player",
    area: "feedback",
    title: "A normal player can post to the board and it appears there",
    why: "This is the public half. Anything a player writes lands on a shared board that other players read and vote on, which is the opposite of how your own reports behave, so it has to be checked from an account that is not yours.",
    needs: ["A second account without the QA role"],
    steps: [
      "Sign in as a normal player account.",
      "Open Feedback, write something, and send it.",
      "Reload the page.",
    ],
    expected: [
      "The item appears on the board with the author's first name.",
      "The confirmation says it was posted and others can upvote it.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "feedback-qa-stays-private",
    area: "feedback",
    title: "Your own reports never reach the board",
    why: "Your account is pinned so that anything you file on /feedback is private. A tester's repro notes are not community feedback, and this is the check that they never leak into a list other players read.",
    steps: [
      "From your own account, file something on /feedback.",
      "Note the confirmation wording.",
      "Sign in as a normal player and open Feedback.",
    ],
    expected: [
      "Your confirmation says it was sent to us, not that it was posted.",
      "The board opens filtered to Mine, newest first, for you.",
      "The normal player cannot see your item anywhere on the board.",
      "Your item carries a marker that it is not on the board, and offers no vote control.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "feedback-vote",
    area: "feedback",
    title: "Voting works and cannot be repeated",
    why: "The board is ranked by votes, so a vote that can be cast twice by one person makes the ranking meaningless.",
    needs: ["A board item from another account"],
    steps: [
      "As a normal player, vote on an item.",
      "Vote again to remove it.",
      "Reload between each.",
    ],
    expected: [
      "The count moves by exactly one each time.",
      "The count after a reload matches what was shown.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "feedback-screenshot",
    area: "feedback",
    title: "A screenshot attached to feedback stays private to its author",
    why: "Screenshots can carry someone's own footage or their email address, so the board never exposes them to other readers even when the item itself is public.",
    needs: ["A second account without the QA role"],
    steps: [
      "As a normal player, file feedback with a screenshot attached.",
      "Open the same board item from a different account.",
    ],
    expected: [
      "The author sees their screenshot.",
      "Another player sees the item without the screenshot.",
    ],
    surfaces: WEB,
    depth: "core",
  },
  {
    id: "feedback-from-match",
    area: "feedback",
    title: "Reporting a problem from a match carries the match with it",
    why: "The report link on a match is the accuracy channel. A report that arrives without knowing which match it came from cannot be looked into, which is the whole reason the link exists rather than a plain Feedback tab.",
    needs: ["A processed match"],
    steps: [
      "Open a match and use the report link on it.",
      "Describe something and send it.",
    ],
    expected: [
      "The form opens already knowing which match you came from.",
      "The submitted report is tied to that match.",
    ],
    surfaces: ALL,
    depth: "core",
  },
  {
    id: "feedback-status-visible",
    area: "feedback",
    title: "A status set on an item is visible to whoever wrote it",
    why: "A board where nothing ever visibly changes teaches people to stop writing. The status is the only signal an author gets that anyone read it.",
    needs: ["An item you filed"],
    steps: [
      "Have the owner set a status on one of your items.",
      "Reopen Feedback.",
    ],
    expected: [
      "The new status shows on your item.",
      "Done and declined items move into the collapsed section rather than vanishing.",
    ],
    surfaces: ALL,
    depth: "edge",
  },

  // -------------------------------------------------------------------------
  // Added 2026-09-08: everything shipped between mid-August and early
  // September that had no case. Grouped by area below; the library groups
  // them under their areas regardless of where they sit in this file.
  // -------------------------------------------------------------------------

  // Shell, sign-in, landing
  {
    id: "nav-workspace-switch",
    area: "nav",
    title: "Switching between Playing and Coaching swaps the whole app",
    why: "One account has two sides. A player who also coaches switches in Account, and the whole app changes: different tabs, different home, different Learn. The choice is remembered per account, so the next launch opens on the side that was last used.",
    needs: ["An account that has set up coach mode"],
    steps: [
      "Open Account and switch to Coaching.",
      "Look at the tabs, then switch back to Playing.",
      "Close the app or browser and reopen it.",
    ],
    expected: [
      "Coaching shows Home and Students; Playing shows Home, Matches, Journal and Coaching.",
      "The side you were last on is the one that opens next time.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "auth-first-run-tutorial",
    area: "auth",
    title: "The first-time tutorial shows once, before the first recording or upload",
    why: "New accounts used to swipe away one tall sheet about camera placement and then film badly. Now five short pages, one idea each, show once per account the first time they go to record or upload, and there is no way out except through. It must never show a second time.",
    needs: ["A brand-new account"],
    steps: [
      "On the app, tap New match and pick any door. On the web, open Upload.",
      "Read through all five pages.",
      "Go back and start a second recording or upload.",
    ],
    expected: [
      "The five pages appear the first time, with a picture and one idea each, and Next is the only way forward.",
      "The second time, they do not appear.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "landing-ios-beta",
    area: "landing",
    title: "Get the iPhone beta emails the TestFlight link",
    why: "The landing page offers the iPhone app without making anyone a middleman. One email address in, and the TestFlight link and short instructions come back by email. The address is used for beta access only, not marketing.",
    steps: [
      "Signed out, open the landing page and press Get the iPhone beta.",
      "Enter an address you can read and send it.",
    ],
    expected: [
      "The dialog explains TestFlight in a sentence and confirms the send calmly.",
      "An email arrives with the TestFlight link and how to install.",
    ],
    surfaces: WEB,
    depth: "core",
    added: "2026-09-08",
  },

  // Recording and the match page
  {
    id: "upload-record-in-app",
    area: "upload",
    title: "A match can be recorded inside the app",
    why: "The app can film a match itself, landscape, from a tripod, and hand the recording straight to processing. It is the door most players will use on a phone, so the camera guide, the recording and the upload afterwards all have to work in one go.",
    steps: [
      "Tap New match and choose Record.",
      "Follow the camera guide, record a minute or two of play in landscape, and stop.",
      "Fill in the opponent and venue and save.",
    ],
    expected: [
      "The recording lands in Matches with its details.",
      "Processing can be started on it like any upload, and the upload continues if the phone locks.",
    ],
    surfaces: APP,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-tools-rows",
    area: "match",
    title: "Each Tools row opens the right thing",
    why: "The match page's Tools area was simplified in September 2026 so every row names one job: Highlights, Match analysis, Serve placement, Share a link, Coach, Export, and Notes. The right-hand side of each row says its state, so a row that says Not shared or Ready is a claim to check.",
    needs: ["A processed and scored match"],
    steps: ["Open the match and tap each Tools row in turn."],
    expected: [
      "Highlights opens the highlight reel; Match analysis the analysis cards; Serve placement the maps; Share a link the public link sheet; Coach the private coach access; Export the video files.",
      "The state written on each row matches what opens.",
    ],
    surfaces: ALL,
    depth: "smoke",
    added: "2026-09-08",
  },
  {
    id: "match-original",
    area: "match",
    title: "Original plays the uncut upload",
    why: "Originals have been kept for the life of the match since August 2026. Original under the video plays the file as it came off the phone, before the dead time was cut out. Only matches processed before mid-August can lack one, and those say the original is no longer stored rather than failing.",
    needs: ["A processed match uploaded after mid-August 2026"],
    steps: ["Open the match and press Original.", "Scrub through it."],
    expected: [
      "The full uncut recording plays, including the time between points.",
      "A request that cannot be answered says why in plain words rather than an error.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-clip-ends-at-winner",
    area: "match",
    title: "A scored point's clip ends just after the winner tap",
    why: "A point clip used to run into the padding after the rally. Since a point is scored at the moment it ends, playback now stops about half a second after that tap. A point nobody scored ends when the rally visibly ends instead, plus a short buffer.",
    needs: ["A match with some points scored and some not"],
    steps: [
      "Play a scored point to the end.",
      "Play an unscored point to the end.",
    ],
    expected: [
      "The scored point stops shortly after the ball is dead, not seconds later.",
      "The unscored point stops soon after the rally ends, and never cuts a rally short.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-adjust-point",
    area: "match",
    title: "Adjusting a point's start or end updates the clip immediately",
    why: "The timeline is the truth and the clip file is a copy that catches up. Moving a point's start or end changes what plays at once, on every surface, without a spinner or a locked screen. The file is re-cut in the background for shares and exports.",
    needs: ["A processed match"],
    steps: [
      "Open a point, choose Modify then Adjust, and move the start earlier by a couple of seconds.",
      "Play the point, then reload the match and play it again.",
    ],
    expected: [
      "The point plays from the new start straight away and after the reload.",
      "The point's position in the list and its score are unchanged.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-split-join",
    area: "match",
    title: "A clip holding two rallies can be split, and two halves joined",
    why: "Processing sometimes puts two rallies in one clip or one rally across two. Split cuts a clip at the playhead into two points; Join merges a point with its neighbour. Both keep the scoring that was already there for the points that survive.",
    needs: ["A processed match"],
    steps: [
      "Find a clip with two rallies, scrub to the gap, choose Modify then Split.",
      "Choose Modify then Join on the two halves.",
    ],
    expected: [
      "After the split there are two points, each holding one rally, and the numbering shifts to make room.",
      "After the join there is one point again, and nothing else in the list moved.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-insert-rally",
    area: "match",
    title: "A missing rally can be inserted from the original video",
    why: "The cut occasionally drops a rally. Insert opens the original video around the gap between two points so the missing rally can be marked and added as a point of its own, in the right place, with the serve rotation moving on from it.",
    needs: ["A processed match whose original is kept"],
    steps: [
      "Between two points, choose Insert a rally.",
      "Find the rally in the original, mark its start and end, and save.",
    ],
    expected: [
      "A new point appears between the two, plays the marked rally, and the points after it renumber.",
      "Scoring on the neighbours is untouched, and the server shown on later points follows the inserted point.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-delete-dead-space",
    area: "match",
    title: "Dead space between points can be deleted",
    why: "A clip that is only the walk to pick up a ball is not a point. Delete removes it from the list without touching the video on either side, and the point numbers close up.",
    needs: ["A processed match with a clip that holds no rally"],
    steps: ["Open the clip and choose Delete, dead space.", "Confirm."],
    expected: [
      "The clip is gone from the list and the numbers close up.",
      "The neighbouring points still play exactly as before.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "scoring-server-correction",
    area: "scoring",
    title: "Who served can be corrected, and the rotation follows from there",
    why: "The app works out who serves from the first server and the score, two serves each and one each at deuce. If it is wrong, every serve after it is wrong, so the server on any point can be overridden and everything downstream re-anchors on that point.",
    needs: ["A scored match"],
    steps: [
      "On a point, change who served using the server chip.",
      "Look at the points that follow.",
    ],
    expected: [
      "The corrected point shows the new server.",
      "Every later point follows the rotation from the corrected one, and the earlier points are unchanged.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-starred",
    area: "match",
    title: "Starring a point puts it on the Starred shelf",
    why: "Starred is where the best rallies across every match are kept, one tap from Account, and it feeds the starred share link and the highlights export. A star that does not reach the shelf is a rally lost.",
    needs: ["Two processed matches"],
    steps: [
      "Star a point in each match.",
      "Open Starred from Account.",
      "Unstar one and come back.",
    ],
    expected: [
      "Both points appear on the shelf with their match named, and each plays.",
      "The unstarred one leaves the shelf.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-analysis",
    area: "match",
    title: "Match analysis appears once a match is scored",
    why: "The analysis cards read the scored match: how points were won and lost, serving against receiving, and the reasons recorded while scoring. They mean nothing on an unscored match, so they do not appear until the scoring is there.",
    needs: ["One fully scored match and one unscored match"],
    steps: [
      "Open Match analysis from Tools on the scored match.",
      "Look for it on the unscored match.",
    ],
    expected: [
      "The scored match shows the cards, and their numbers agree with the point list.",
      "The unscored match does not offer analysis, or says scoring comes first.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "match-highlights",
    area: "match",
    title: "The highlight reel is there, plays, and can be shared",
    why: "Highlights are picked automatically from the rallies once a match is processed and scored. They are switched on per account while the picker is tuned, so an account not on the list sees no reel, which is a setting rather than a bug. Ask Adil to add your account before running this.",
    needs: [
      "Your account switched on for automatic highlights (ask Adil)",
      "A processed and scored match with some long rallies",
    ],
    steps: [
      "Open Highlights from Tools.",
      "Play the reel, then share it.",
    ],
    expected: [
      "The reel holds the match's longer rallies and plays through.",
      "Sharing offers the same doors as a point: a link, and Instagram on the app.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },

  // Sharing
  {
    id: "sharing-score-and-stats",
    area: "sharing",
    title: "Include score and stats puts the running score on a shared match",
    why: "A match link can carry the scoring with it. With the switch on, a stranger sees the running score over the video, the final result, the analysis and the placement maps. With it off they see the video and nothing about the score.",
    needs: ["A scored match"],
    steps: [
      "Open Share a link, leave Include score and stats on, and create the link.",
      "Open it signed out.",
      "Turn the switch off and open the link again.",
    ],
    expected: [
      "With the switch on, the score runs over the video and the result and maps show below.",
      "With it off, the same link shows the video only.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "sharing-instagram",
    area: "sharing",
    title: "A point can be shared to Instagram from the app",
    why: "A rally is the thing people most want to post. The app renders a vertical clip with the score on it and hands it to Instagram as a story or a reel. Instagram has to be installed for the door to appear, and the hand-off should carry the clip, not a link.",
    needs: ["Instagram installed on the phone"],
    steps: [
      "Open a point and choose Share, then Instagram.",
      "Wait for the render and pick Story or Reel.",
    ],
    expected: [
      "Instagram opens with the clip ready to post, in portrait, with the score on it.",
      "Without Instagram installed the door does not appear.",
    ],
    surfaces: APP,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "sharing-journal-entry",
    area: "sharing",
    title: "A journal entry can be shared as a public link and revoked",
    why: "A student can send a coach one entry without giving them the journal. Share beside Delete makes a live read-only link; edits show up on it, deleting the entry kills it, and Account lists it under Journal beside the match links so Revoke all covers it too.",
    needs: ["A journal entry with takeaways or a photo"],
    steps: [
      "On the entry, press Share and copy the link.",
      "Open it signed out.",
      "Revoke it from the same sheet, or from Account, and open it again.",
    ],
    expected: [
      "Signed out, the link shows the entry, its takeaways and photo, and nothing else of the journal.",
      "After revoking, the link says it was turned off, the same page a made-up link shows.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "sharing-invite-opens-app",
    area: "sharing",
    title: "An invite link opens the app, on a screen that names the account",
    why: "Since September 2026 a coach's invite scanned on a phone with the app opens the app, not the browser, signed in as the app's account. The screen says who is inviting and which account is about to join, with a way to sign out if it is the wrong one. Signed out, the app asks to sign in first and keeps the invite waiting.",
    needs: ["A second account acting as the coach, with its invite QR ready"],
    steps: [
      "Signed in on the app, scan the coach's QR with the camera.",
      "Read the screen, then join.",
      "Sign out of the app, scan the QR again, and sign in.",
    ],
    expected: [
      "The app opens on an Invite screen that names the coach and says Joining as with your name and email.",
      "After joining, the coach appears on your Coaching tab. Signed out, the sign-in screen says who invited you and the Invite screen appears once you are in.",
    ],
    surfaces: APP,
    depth: "smoke",
    added: "2026-09-08",
  },
  {
    id: "sharing-invite-names-account",
    area: "sharing",
    title: "The invite page says who is signed in and can switch",
    why: "An invite accepted by the wrong account is hard to undo, and on 2026-09-07 one was, because the page never said whose account it had. Both invite pages now say Signed in as, and Not you? switches account in this browser only and comes straight back to the invite.",
    needs: ["A student invite link or a coach invite link", "Two accounts"],
    steps: [
      "Signed in as the first account, open the invite link.",
      "Press Not you? Switch account and sign in as the second.",
    ],
    expected: [
      "The page names the first account above the button.",
      "After switching, you land back on the same invite, now naming the second account, and the first account is still signed in on any other device.",
    ],
    surfaces: WEB,
    depth: "core",
    added: "2026-09-08",
  },

  // Journal
  {
    id: "journal-dictate-links",
    area: "journal",
    title: "A note can be dictated, and links in it open",
    why: "Most notes are written just after a session, with a phone in one hand. The microphone turns speech into text in the composer, and any web address written or spoken into a note becomes a link that opens, on both the journal and the shared page.",
    steps: [
      "On a phone, start a new note, tap the microphone and speak two sentences.",
      "Type a web address into the note and save.",
      "Open the saved note and tap the address.",
    ],
    expected: [
      "The spoken sentences appear as text and can be edited before saving.",
      "The address is tappable and opens in the browser.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "journal-recollect-off",
    area: "journal",
    title: "Turning Recollect off removes its tab",
    why: "Recollect brings old entries back at the right time. It is a choice, made in Account, and the journal must not keep a tab for something the player switched off.",
    steps: [
      "In Account, turn Recollect off.",
      "Open Journal.",
      "Turn it back on.",
    ],
    expected: [
      "With it off, the Recollect tab is gone and the journal opens on All.",
      "With it on again, the tab is back.",
    ],
    surfaces: ALL,
    depth: "edge",
    added: "2026-09-08",
  },

  // Coaching tab and lessons (the player's side)
  {
    id: "lessons-coaching-tab",
    area: "lessons",
    title: "The Coaching tab shows everything from every connected coach",
    why: "Coaching is the fourth tab for every player. It opens on one feed across all coaches, with a filter per coach that cannot be missed, and a coach's own page one tap away. A player with no coach sees how to add one, not an empty screen.",
    needs: ["An account connected to at least one coach who has shared something"],
    steps: [
      "Open the Coaching tab.",
      "Filter by one coach, then clear the filter.",
      "Open a coach's page.",
    ],
    expected: [
      "The feed shows the coaches' shared entries and recaps, newest first.",
      "The filter narrows it to one coach, and the coach's page lists what is between you.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "lessons-shared-entry",
    area: "lessons",
    title: "An entry a coach shares reaches the student",
    why: "A coach writes for a student and chooses to share it. When they do, it appears in the student's Home under From coaches, on the Coaching tab, and in the journal's From Coaches tab, with the coach's name on it. Until they share it, the student sees nothing.",
    needs: ["A second account acting as the coach, connected to yours"],
    steps: [
      "As the coach, write an entry for the student and save it without sharing.",
      "Check the student's Home, Coaching tab and journal.",
      "As the coach, share it, then check again.",
    ],
    expected: [
      "Before sharing, nothing shows for the student.",
      "After sharing, the entry shows in all three places with the coach's name, and a notification arrives.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "lessons-recap-plays",
    area: "lessons",
    title: "A lesson recap shared by a coach plays with its chapters",
    why: "A coach can import a filmed lesson and get a recap: the lesson broken into chapters, each with what was taught. Shared with the student, it opens from their journal or Coaching tab in the app's own player, and a tap on a chapter jumps to it.",
    needs: ["A coach who has shared a lesson recap with your account"],
    steps: [
      "Open the recap from the Coaching tab.",
      "Play it and tap a later chapter.",
    ],
    expected: [
      "The recap plays and the chapter list matches what is said in the video.",
      "Tapping a chapter jumps the video to it.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },

  // Coach side
  {
    id: "coaching-roster-invite",
    area: "coaching",
    title: "A coach has a roster, and each student gets an invite link and QR",
    why: "Coach mode is a roster of students. A coach adds a student by name before they have an account and writes for them straight away; each row has its own invite, as a link and a QR code, and there is a general invite for someone new. Opening the invite signed in connects that account to the row.",
    needs: ["An account in coach mode"],
    steps: [
      "On the Students tab, add a student by name.",
      "Open their row and press Invite; copy the link and show the QR.",
    ],
    expected: [
      "The student appears on the roster marked as not yet connected.",
      "The invite sheet shows a QR and a link, with Send and Copy, and the same link comes back when opened again.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "coaching-student-joins",
    area: "coaching",
    title: "A student joins from the invite and chooses what the coach can see",
    why: "Joining is an explicit button, because it hands the coach standing access to the player's matches. The student chooses all matches, including future uploads, or only the ones they share from a match page, and the choice can be changed later.",
    needs: ["A second account acting as the student"],
    steps: [
      "As the student, open the coach's invite link, read the page, and choose Only matches I share.",
      "Press Join.",
      "As the coach, open the roster.",
    ],
    expected: [
      "The student's row on the roster becomes connected, with their account's name.",
      "The coach sees no matches until the student shares one from a match page.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "coaching-entries-catch-up",
    area: "coaching",
    title: "Entries written before a student joined reach them when they join",
    why: "A coach can fill a student's folder before the student has an account. Sharing used to wait until the student joined, and the entries never caught up. Now an entry marked to share reaches the student the day they connect.",
    needs: ["A roster row for someone not yet on PongLens", "A second account to join as them"],
    steps: [
      "As the coach, write two entries for the unconnected student and mark them to share.",
      "As the second account, join from that student's invite.",
      "Open the new account's Coaching tab.",
    ],
    expected: [
      "Both entries are there, with the coach's name, without the coach doing anything after the join.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "coaching-student-match",
    area: "coaching",
    title: "A coach can open a student's match, watch it and read the points",
    why: "This is the case that failed on a coach's phone on 2026-09-07. A student's match opens for the coach with the video playing, the poster showing, the points listed as Player and Opponent rather than I and They, the maps and the analysis. The coach can leave notes and cannot score or change anything.",
    needs: ["A connected student who has shared a processed match, or chose all matches"],
    steps: [
      "As the coach, open the student's page and tap one of their matches.",
      "Play the video and open a point.",
      "Try to score a point, then leave a note.",
    ],
    expected: [
      "The video and the poster load and play; Original plays too.",
      "The points read Player served and Player won; scoring is not offered; the note saves and the student is notified.",
    ],
    surfaces: ALL,
    depth: "smoke",
    added: "2026-09-08",
  },
  {
    id: "coaching-write-entry",
    area: "coaching",
    title: "A coach writes an entry for a student, shares it, and can edit it later",
    why: "The coach's composer is the same one the journal has: text, the microphone, one photo, links that open, and Improve with AI to tidy dictation. Sharing is a choice made per entry. A coach can correct an entry after sharing, and the student sees the corrected version.",
    needs: ["A connected student"],
    steps: [
      "On the student's page, press New entry, dictate a few sentences, add a photo and a web address, choose Improve with AI, and save.",
      "Share it with the student.",
      "Edit the entry's text and save again.",
    ],
    expected: [
      "The entry saves with clean text, the photo and a tappable link, and shows on the student's page.",
      "The student sees it after sharing, and sees the edited text afterwards.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "coaching-lesson-video",
    area: "coaching",
    title: "A coach imports a lesson video and shares the recap with the student",
    why: "A filmed lesson, up to three hours, is imported from the phone or the web and turned into a recap: chapters, each with what was taught, over the original video. The import must survive a long upload, the recap must say what the coach actually said, and only the chosen student can see it once shared.",
    needs: ["A lesson recording of at least ten minutes, landscape, with the coach audible", "A connected student"],
    steps: [
      "In coach mode, choose New entry then Lesson video, pick the student, and import the recording.",
      "Wait for the recap and read the chapters against the video.",
      "Share it with the student and open it as them.",
    ],
    expected: [
      "The import shows progress and finishes; the recap appears with chapters that match the lesson.",
      "The student can open it after sharing; before that they cannot.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "coaching-remove-student",
    area: "coaching",
    title: "Removing a student stops them receiving anything more",
    why: "A coach can take a student off the roster. The student stops seeing new entries and the coach stops seeing their matches; what was already shared stays where it is in the student's journal.",
    needs: ["A connected student"],
    steps: [
      "As the coach, remove the student from the roster.",
      "Write and share a new entry for someone else, then check the removed student's account.",
    ],
    expected: [
      "The student is off the roster and their matches are gone from the coach's app.",
      "The removed student receives nothing new and keeps what was shared before.",
    ],
    surfaces: ALL,
    depth: "edge",
    added: "2026-09-08",
  },

  // Learn
  {
    id: "learn-audience",
    area: "learn",
    title: "Learn shows the player's guides or the coach's, and the tutorial videos play",
    why: "Learn has two sets of guides and two tutorial courses, one for playing and one for coaching. It follows the side of the app you are on, with a switch to read the other, and the tutorial videos are the walkthrough of the product in chapters.",
    steps: [
      "Open Learn from Account on the playing side and read the list.",
      "Switch to the coaching set.",
      "Open the tutorial videos and play a chapter.",
    ],
    expected: [
      "The playing side lists guides about recording, scoring and the journal; the coaching set is about students and entries.",
      "A tutorial chapter plays, and the next chapter is one tap away.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },

  // Account and email
  {
    id: "account-share-links-journal",
    area: "account",
    title: "Account lists journal links beside match links, and Revoke all clears both",
    why: "Every public link an account has made is listed in one place so it can be turned off. Journal entry links joined the match, point and starred links in September 2026 under their own Journal heading, named after the entry, and Revoke all must take them too.",
    needs: ["One match link and one journal entry link"],
    steps: [
      "Open the links section in Account.",
      "Press Revoke all and open both links.",
    ],
    expected: [
      "Both links are listed, the journal one under Journal with the entry's title.",
      "After Revoke all, both links show the turned-off page and the section is empty.",
    ],
    surfaces: ALL,
    depth: "core",
    added: "2026-09-08",
  },
  {
    id: "email-coach-events",
    area: "email",
    title: "A student joining, an entry shared and a match ready each notify once",
    why: "The coach side produces its own events. A coach hears when a student joins and when a student's match is ready; a student hears when an entry is shared with them. Each arrives once, in the bell and by email, and the email's link opens the right thing.",
    needs: ["Two accounts, one coaching the other"],
    steps: [
      "Join the coach as the student, then upload and process a match.",
      "As the coach, share an entry with the student.",
      "Check both inboxes and both bells.",
    ],
    expected: [
      "The coach gets one notification and one email for the join and one each for the match.",
      "The student gets one of each for the entry, and every link lands on what it names.",
    ],
    surfaces: WEB,
    depth: "core",
    added: "2026-09-08",
  },
];

/** Cases for one area, in library order. */
export function casesByArea(area: TestArea): TestCase[] {
  return testCases.filter((c) => c.area === area);
}

/** Everything at or above a depth, for "just the smoke set" style filters. */
export function casesAtDepth(depth: TestDepth): TestCase[] {
  const rank: Record<TestDepth, number> = { smoke: 0, core: 1, edge: 2 };
  return testCases.filter((c) => rank[c.depth] <= rank[depth]);
}

/** Everything searchable about a case, lowercased, for the filter box. */
export function testCaseSearchText(c: TestCase): string {
  return [c.id, c.title, c.why, ...(c.needs ?? []), ...c.steps, ...c.expected]
    .join(" ")
    .toLowerCase();
}

export const AREA_TITLE: Record<TestArea, string> = Object.fromEntries(
  TEST_AREAS.map((a) => [a.key, a.title]),
) as Record<TestArea, string>;

/**
 * How long a case reads as "New" after it was added or rewritten. Long
 * enough to outlast a couple of weekly sweeps, short enough that the
 * marker means something.
 */
export const NEW_DAYS = 45;

export function isNewCase(c: TestCase, now: Date = new Date()): boolean {
  if (!c.added) return false;
  const added = Date.parse(c.added);
  if (Number.isNaN(added)) return false;
  return now.getTime() - added < NEW_DAYS * 86_400_000;
}
