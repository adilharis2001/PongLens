# Invite links open in the app: build 165

Released September 7, 2026 from `15480f15` on main, which carries the
Universal Links work in `08611a79` and `4a452305`, the sign-out change in
`87129b18`, and the TestFlight line in `48715026`.

- Coach and student invite links (`/join/<token>` and
  `/coach-invite/<token>`) open inside the app on a phone that has it. The
  app carries the Associated Domains entitlement for `www.ponglens.com`, and
  the website serves the Apple app-site-association file for the two invite
  paths. Apple's cache already returns it.
- A new native accept sheet handles both invite kinds with the same database
  functions and sentences as the web pages, and names the account about to
  accept, with a this-device-only sign-out beside it. An invite that arrives
  signed out waits through sign-in and onboarding; the sign-in screen says
  who is inviting.
- Signing out is this device only, on iOS and on the web. A session revoked
  elsewhere is now noticed at the app's next server call (refresh, then a
  local sign-out when the refresh is refused) instead of an hour of dead
  video. "The original is no longer available" is reserved for a file that
  is gone; a failed request says so.
- Web: both invite pages say which account is signed in and offer a switch;
  the coach invite is accepted by a tap, not on arrival; the pages carry the
  public TestFlight link for phones without the app.
- Verified on the iPhone Air simulator against production: the join link
  opened the app's sheet, Join wrote the roster row and link (reverted
  afterwards), reopening showed the already-connected notice, and "Not you?
  Sign out" returned to the sign-in screen with the invite line. The first
  attempt crashed for a missing environment hand-off to the sheet; fixed in
  `4a452305` and re-verified.
- Full Next.js production build passed on the shipped tree. The auth unit
  tests passed after the removal of the sign-in-time auto-accept.
- App Store Connect accepted iOS version 1.0 build 165 for processing.

Archive: `/tmp/PongLens-invite-links-1.0-165.xcarchive`.
Build log: `/tmp/ponglens-invite-links-165-archive.log`.
Upload log: `/tmp/ponglens-invite-links-165-export.log`.

Apple processing completion, TestFlight Beta App Review for external
testers, and a real-phone scan of a coach's QR remain unverified.
