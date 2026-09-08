# Invite links open in the app

**Date:** 2026-09-07
**Status:** Implemented 2026-09-07 (commits 08611a79 and 4a452305). Web half
live; iOS half waits for the next TestFlight build. Adil chose the explicit
Accept on the coach-invite page; the throwaway account was left alone. Part 5
(the TestFlight line) is not built: there is no public TestFlight link in
app_config yet.

## Purpose

A coach shows a student a QR code. The student scans it. Today that link
opens in whatever browser the phone uses, signed in as whoever that browser
last held, and the browser accepts the invite for that account without ever
saying whose account it is. On 2026-09-07 that put a throwaway account on
Anton's roster under the name "Joe" while the PongLens app on the same phone
was signed in as Adil.

After this change, a phone with the PongLens app installed opens the invite
inside the app, as the account the app is signed into, and shows who is about
to join before anything is written. A phone without the app keeps today's web
page, which now also says which account is joining and offers a way to switch.

## What happened on 2026-09-07, and what it means

Two observations came in together. They have different answers.

### The account nobody remembers creating

`anything@ponglens.com` was not created by the software. It was created by a
person, and here is the whole chain, from the auth logs, the database and the
support mailbox:

- 2:39:10 PM. A Mac browser on the same network as Anton's laptop (the same
  address block as Anton's own web session that afternoon) signed Anton's
  account out of the website.
- 2:39:26 PM. Sixteen seconds later the same Mac, on the plain sign-in page
  (the request carried `next=/dashboard`, which is what the sign-in page
  sends when nobody arrived through an invite), asked for a sign-in email
  for `anything@ponglens.com`. That is the ordinary "Email me a code" form.
  Nothing else in the product can request one: the address appears nowhere
  in the code, the only call that sends a sign-in email is the button on that
  form, and the admin link-minting in `scripts/` is hard-wired to Adil's own
  account or to accounts named in environment variables (none of which are on
  the ponglens.com domain).
- 2:39:30 PM. Because every address at ponglens.com is delivered to the
  support inbox by the domain's catch-all, the "Confirm your email" mail
  landed there.
- 2:39:39 PM. Nine seconds later the button in that mail was pressed, from a
  device that had the support inbox open. The account was confirmed.
- 2:39:49 PM. Onboarding was completed on the website with the name "Adil",
  right-handed, shakehand, beginner.
- 3:07 PM. Anton added a roster row called "Joe" and made an invite for it.
  The invite was opened on an iPhone browser that was still signed in as
  `anything@ponglens.com`, and accepted. That is why "Joe" is connected to
  that account.
- 6:15 PM. The same phone browser was still signed in as the throwaway when
  Adil scanned a second QR, which is the screenshot. He signed it out at
  6:15:34 PM.

The certain part is that a person typed the address and a person confirmed
it. The most likely reading is that Anton typed a throwaway address on his
laptop to see the student side, and the confirmation email was tapped from
the support inbox on Adil's phone, which is also where the name "Adil" was
typed. Nobody needs to remember it for the fix to be right, because the fix
is not about that account: it is that the join page accepted an invite for
an account it never named. The catch-all itself is fine and stays; it just
means any address at the domain can be signed up by whoever reads support.

What to do about the throwaway is a decision for Adil (see the end). It has
no matches and no journal entries.

### The QR opened the browser

The iOS app does not claim ponglens.com links. Its entitlements carry only
Sign in with Apple; there is no Associated Domains entry, and the website
serves no `/.well-known/apple-app-site-association` file. The app also has no
handler for an incoming link of any kind, and no screen that can accept an
invite. So iOS hands every `https://www.ponglens.com/...` link to the default
browser, always. The browser then accepts for whatever account it holds.

## Product outcome

- A student who scans a coach's QR on a phone with the app opens the app,
  sees "Join Anton" with their own name and email on the screen, chooses
  whether the coach sees all their matches or only shared ones, and taps
  once. If they are signed out, they sign in first and land on the same
  screen; the invite is not lost across sign-in or first-run setup.
- A player who opens a coach invite link in the app sees who is inviting them
  and which account will accept, and confirms with one tap.
- On a phone without the app, or on a laptop, the web page does the same job
  and now says "Signed in as ..." with a way to switch accounts. After joining
  on the web, a phone user is told the iPhone app exists and where to get it.
- Nothing about who can see what changes. The same database functions accept
  the same invites with the same checks.

## Scope

1. The website: one new file for Apple, one middleware exclusion, and the
   "signed in as" line on both invite pages.
2. The iOS app: the entitlement, link handling, two accept screens, and the
   pending-invite state across sign-in and onboarding.
3. Apple: one capability toggle on the App ID, which only Adil can do.
4. Release order, because the web half must be live before the app half.

## Non-goals

- No change to which invites exist, how they are minted, or how they expire.
- No change to the database functions or their permissions. All four are
  already callable from the app.
- No deep links for share pages, matches, journal or account in this round.
  The Apple file lists only the two invite paths; adding more later is one
  line each, once the app has a screen to open.
- No attempt to open the app from the bare `ponglens.com` host. The apex
  answers every request with a redirect to `www`, Apple does not follow
  redirects when it reads the association file, and every link the product
  mints already uses `www`.

## Design

### Part 1. The website vouches for the app

Apple decides whether a link may open an app by fetching
`https://www.ponglens.com/.well-known/apple-app-site-association` through its
own servers when the app is installed or updated. The file names the app and
the paths it may claim.

- Serve it from a route handler, `src/app/.well-known/apple-app-site-association/route.ts`,
  returning exactly:

  ```json
  {
    "applinks": {
      "details": [
        {
          "appIDs": ["ACUSR8S5R9.com.ponglens.PongLens"],
          "components": [
            { "/": "/join/*" },
            { "/": "/coach-invite/*" }
          ]
        }
      ]
    }
  }
  ```

  with `Content-Type: application/json` and a one-hour public cache header.
  A route handler rather than a file in `public/`, because the file has no
  extension, the site sends `X-Content-Type-Options: nosniff`, and Apple
  requires the JSON content type. `ACUSR8S5R9` is the team, and
  `com.ponglens.PongLens` the bundle identifier, both from the Xcode project.
- Add `.well-known` to the middleware matcher's exclusion list in
  `src/middleware.ts`. Today the middleware runs on that path, which means
  every fetch by Apple's servers triggers a Supabase session check and gets
  cookies back. Harmless, but pointless, and one less thing to reason about.
- Verify with `curl -sI https://www.ponglens.com/.well-known/apple-app-site-association`
  (200, JSON, no redirect) and then through Apple's own cache at
  `https://app-site-association.cdn-apple.com/a/v1/www.ponglens.com`, which
  is what phones actually read.

### Part 2. The app claims the links

Two halves that must agree.

- **Adil's step, in the Apple developer account.** Go to
  https://developer.apple.com/account/resources/identifiers/list, open the
  identifier `com.ponglens.PongLens` (it is listed under the app's name),
  scroll the Capabilities list to **Associated Domains**, tick it, and press
  **Save** at the top right. Two minutes. Xcode's automatic signing then
  regenerates the provisioning profile on the next build; if it complains
  about entitlements, Xcode → Signing & Capabilities → the warning's
  "Try again" button clears it.
- **In the repo.** `ios/PongLens/PongLens/PongLens.entitlements` gains

  ```xml
  <key>com.apple.developer.associated-domains</key>
  <array>
      <string>applinks:www.ponglens.com</string>
  </array>
  ```

  Debug and Release share this one file, so one edit covers both. During
  development the string can be `applinks:www.ponglens.com?mode=developer`
  so a debug build reads the association file directly instead of through
  Apple's cache; production builds ignore the suffix, but it should be
  removed before a TestFlight build all the same.

### Part 3. The app handles a link

The app receives the link in two ways, and both are wired at the root:
`.onOpenURL` for a cold start and `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)`
for a Universal Link. Both feed one parser and one piece of state.

- **Parser.** A new `InviteLink` in `Core/`, copied in shape from
  `LessonVideoLink` in `Core/LessonVideo.swift`, which already normalises
  `ponglens.com` and `www.ponglens.com` and pulls a UUID out of a path. Two
  cases: `.student(token)` for `/join/<uuid>` and `.coach(token)` for
  `/coach-invite/<uuid>`. Anything else returns nil and the system handles
  the link as before.
- **Where the pending link lives.** On `RootView`'s own state, beside the
  existing `lessonVideoLink`. Not on the router: `RootView` recreates the
  router on every account change, which is exactly the moment a signed-out
  arrival becomes a signed-in one. The link must survive the sign-in screen
  and the first-run onboarding gate, and is cleared only when the accept
  screen closes.
- **Signed out.** The sign-in screen shows one extra line above the form:
  "Sign in to accept the invite from Anton." The coach's name comes from
  `student_invite_preview` (or `coach_invite_preview`), which the website's
  link previews already call anonymously, so it needs no session. After
  sign-in and onboarding, the accept screen appears on its own.
- **Student accept screen** (`/join`). A sheet that mirrors the web's
  `JoinCoach`, built from `student_invite_info(p_token)` and closed by
  `accept_student_invite(p_token, p_all_matches)`. It shows, in this order:
  the coach's name as the heading; a line "Joining as John Miller ·
  john@example.com" with a "Not you? Sign out" text button that signs out of
  this device only and returns to the sign-in screen with the invite still
  pending; the same all-matches-or-shared-only choice as the web, defaulting
  to all matches; a name field only when the account has no name yet, as on
  the web; and one button, "Join Anton". The same three side cases the web
  handles get the web's sentences: your own invite, a revoked invite, and
  already connected. After joining, the app switches to the Journal tab, the
  place the web sends people (`/journal?from=coach`).
- **Coach accept screen** (`/coach-invite`). Same sheet shape, built from
  `coach_invite_info(token)` and closed by `accept_coach_invite(token)`,
  heading "Anton invites you to coach", the same "Accepting as ..." line, one
  button. On success the app flips to the coach workspace and opens what the
  web opens: the shared match if the invite was for one match, otherwise the
  student's row.
- **Copy** follows the product's rules: plain sentences, no subtitle under
  the heading, "Sign out" rather than anything cleverer.

### Part 4. The web page names the account

Both invite pages already hold the signed-in user's email and name and simply
never render them. Each gets one line under the heading, "Signed in as
john@example.com", followed by a "Not you? Switch account" text button that
signs out of this browser only (the `scope: "local"` sign-out that shipped
today) and returns to `/login?next=<this invite>`. On the join page this sits
above the "Join Anton" button. On the coach-invite page it sits above an
explicit "Accept" button, which is the decision for Adil below: today that
page accepts on arrival, before anyone could have read whose account it
landed in.

### Part 5. Phones without the app

Nothing changes for them except two lines. The web join page, after a
successful join on a phone, says "PongLens is also an iPhone app in beta. Get
it on TestFlight." with the public TestFlight link. The link is a value in
`app_config` under a new key, and that key must be added to the anon
allow-list from migration 107 or the page will simply not show it. If no
public TestFlight link exists yet, the line is left out until one does.
Universal Links do not depend on the App Store; they work on TestFlight
builds, and a phone that has no app installed falls through to the web page
exactly as today.

## Release order

The order matters, because a web deployment cannot change an installed
build, and a build with the entitlement but no association file does nothing.

1. Ship Part 1 and Part 4 to the website. Confirm the association file over
   `curl` and through Apple's cache address.
2. Adil enables Associated Domains on the App ID (Part 2).
3. Ship the app with Part 2 and Part 3 to TestFlight. External testers need
   TestFlight Beta App Review, as with every build.
4. On a real phone with the new build installed, scan a QR from a coach's
   phone. The invite opens in the app. Settings → Developer → Universal
   Links → Diagnostics on the phone confirms the association if it does not.
   Apple's cache can hold an old answer for up to a day, which is why step 1
   goes first.

## Verification

- `curl` the association file: status 200, JSON body, `application/json`.
- The middleware no longer runs for `.well-known` paths (no Supabase cookies
  on the response).
- Web: open a join link signed in as the test account; the page names the
  account; "Not you?" signs out this browser only (session count for the
  account drops by exactly one) and comes back to the same invite.
- iOS, simulator with a debug build and `?mode=developer`:
  `xcrun simctl openurl booted https://www.ponglens.com/join/<token>` opens
  the accept sheet signed in; the same link on a signed-out app shows the
  sign-in line, and the sheet appears after signing in.
- iOS, real phone on TestFlight: scan a coach's QR; the app opens.
- The four database functions are unchanged, so their existing checks stand:
  a revoked invite, a coach's own invite and an already-linked student all
  get the same answers from the app as from the web.

## Decisions for Adil

1. **The coach-invite page: accept on arrival, or one explicit button?** The
   recommendation is the button, matching the join page, so nobody accepts
   into an account they had no chance to see. It costs one tap.
2. **The throwaway account.** `anything@ponglens.com` can be deleted along
   with its link to Anton's roster; the "Joe" row would go back to "waiting
   for the student" or be removed, whichever Anton prefers. Or leave it; it
   holds nothing.

## Effort

Web: about half a day, including the "signed in as" line on both pages.
iOS: one to two days, most of it the two accept screens and carrying the
invite across sign-in and onboarding. Apple: two minutes of Adil's time, then
a TestFlight build.
