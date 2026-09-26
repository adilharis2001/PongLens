# App Store review checklist

Build 246 should not be submitted as it is: the feedback board has no way to
report or block anyone, which is close to a certain rejection, and about a
dozen small fixes sit around it. The plan is one "submission build" that
clears section 2, then the App Store Connect steps in section 3 against that
build, then Submit. Everything else in the app passed a five-part audit of
the whole iPhone codebase on 2026-09-26.

Status words: **open**, **done**, **watch** (done, but it can rot).
Severity: **Reject** = Apple will almost certainly send it back.
**Likely** = a common rejection. **Risk** = worth fixing, rarely checked.

---

## 1. Decisions only Adil can make

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | Feedback board on iPhone for 1.0 | **Hide it on iPhone for 1.0, keep it on the web.** Bring it back in 1.1 with Report, Block and a text filter. | Hiding is a small change. Building report, block, admin hide and a filter first is a medium one and delays the submission. It also removes the only place where 13 to 17 year olds' names and photos are shown to strangers. |
| D2 | Match frames sent to OpenAI | **Say it in the upload confirmation**, one line naming OpenAI. Do not change the worker. | Every upload sends about 12 still frames to OpenAI for the "is this table tennis" check, and sometimes more to find the table. The privacy policy says so; nothing in the app does. Apple's 2025 rule wants permission in the app. Gating the worker instead would need a new sealed release on the Mac and the cloud twin. |
| D3 | Content rights answer in App Store Connect | **"Yes, and I have the necessary rights."** | Every video is uploaded by a user who promises in the Terms that they hold the rights. |
| D4 | The small "BETA" chips on analysis cards and placement | **Rename to "Estimated".** | Apple accepts feature labels, but a reviewer scanning for the word "beta" finds five. "Estimated" also tells players something true. |
| D5 | Submit before or after the Apple account becomes AH Labs LLC | **Wait, if the conversion lands while section 2 is being built.** Do not hold the submission for it otherwise. | Until it converts, the App Store shows "Adil Haris" as the seller. Conversion was requested on 2026-09-25. |
| D6 | In-app purchases for 1.0 | **Leave all five out.** Keep `purchases_enabled` false until they ship in a later version. | Purchases are switched off, and the review notes say the app sells nothing. That is true today. |

---

## 2. The submission build (code changes)

One build, then TestFlight, then section 3. Web changes marked "web" ship
with a normal deploy and need no build.

| # | Fix | Severity | Where | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| A1 | **Feedback board**: hide on iPhone (per D1), or add Report and Block to every post and comment, an admin "hide from board", and a text filter | Reject, 1.2 | iPhone Home section, Feedback screen, Account row | S if hidden, M if built | open |
| A2 | **Sign in with Apple asks for a name Apple already gave.** The app requests the name, discards it, then blocks onboarding on "What should we call you?". Save Apple's name to the profile. | Likely, 4.0 | Login screen, onboarding | S | open |
| A3 | **Remove "PongLens is in beta"** from the storage and minutes request rows, and retitle the "Processing is in beta" page of the recording brief | Likely, 2.2 | iPhone and web | S | open |
| A4 | **Remove the "More match analysis cards coming soon." card** at the end of the analysis deck | Risk, 2.1 | iPhone and web | S | open |
| A5 | Apply D4 to the BETA chips; drop "Placement is still in beta" and both Recollect mentions from the Learn guides | Risk, 2.2 / 2.3.1 | iPhone, web, Learn catalog | S | open |
| A6 | **AI sheet wording**: land the shorter sheet (already written, applies cleanly). It also fixes the old wording, which says lesson "transcripts" when lesson audio and video go to OpenAI. | Risk, 5.1.2(i) | iPhone and web | S | open |
| A7 | **Upload confirmation names OpenAI for match frames** (per D2) | Likely, 5.1.2(i) | iPhone and web upload checkbox | S | open |
| A8 | **Invite links open Safari, not the app, for App Store users.** The only associated-domain entry is developer mode, which distribution builds ignore. Add the plain `applinks:www.ponglens.com` entry. | Functional | Entitlements | S | open |
| A9 | **Contact details visible**: show support@ponglens.com as text on the Account screen and the sign-in screen, and fall back to it when Mail is not set up | Risk, 1.2 / 2.1 | iPhone | S | open |
| A10 | **Under-age answer is forgotten.** Signing in again brings a fresh date picker. Remember the refusal on the device. | Risk, minors | iPhone onboarding | S | open |
| A11 | **Terms**: a zero-tolerance line for objectionable content and abusive users, and a 24-hour promise on reports (today: "a few business days") | Likely, 1.2 | web | S | open |
| A12 | **Privacy policy** still describes "iPhone beta requests"; the DMCA agent block still has no phone number | Risk, 2.2 / legal | web | S | open |
| A13 | **Support URL shows no contact.** App Store Connect points at /learn, which has no address on it. Add a contact line there. | Risk, 1.2(d) | web | S | open |
| A14 | **Sign in with Apple is not revoked when an account is deleted.** Apple requires it in writing. Needs a Sign in with Apple key created at https://developer.apple.com/account (Keys, then +, tick Sign in with Apple). | Risk, 5.1.1(v) | server and iPhone | M | open |
| A15 | **Privacy manifest** is missing birth month and year, the "how did you hear" answer, device model and cut timings from hand cut, and board posts | Risk, 5.1.2 | iPhone | S | open |

---

## 3. App Store Connect, after the build is uploaded

https://appstoreconnect.apple.com, then Apps, then PongLens, then version 1.0.

| # | Step | Status |
| --- | --- | --- |
| B1 | Attach the submission build to version 1.0. It still points at build 208 from 15 September. | open |
| B2 | Content rights (per D3). App Information, Content Rights. | open |
| B3 | App Privacy answers. Cannot be read through Apple's API, so they have to be checked by eye against the table below. | open |
| B4 | Screenshots: regenerate at 6.9 inch. The current ten are 6.7 inch, the journal one shows the removed Recollect tab, and none may show a beta word or the board if it is hidden. | open |
| B5 | Review notes: say the in-app purchase code is present but off and ships later; say the coach marketplace is web-only and absent from iOS; mention Sign in with Apple and Google; say where the background audio is used; ask the reviewer not to delete the demo account, because it comes back empty. | open |
| B6 | Set the cloud backup to Standby for the review window, so a reviewer's upload is processed even if the Mac stalls. /admin/processing. | open |
| B7 | Final pass on a real iPhone with the TestFlight build: fresh install, both review accounts, Sign in with Apple, an invite link from Messages, the AI sheet appears once. | open |
| B8 | Delete the throwaway accounts `adilharis2001+sim`, `+web`, `+web2`, `+web3` (+web2 was used on 23 September, so check no chat still needs it). | open |
| B9 | Submit. | open |

Already set and verified 2026-09-26: category Sports, age rating 13+ with
user content and messaging declared, free, 144 territories with Europe, the
UK and Switzerland off, copyright "2026 AH Labs LLC", description, keywords,
URLs, export compliance, both review accounts (terms accepted, AI question
not yet answered, player account holds a 60-point processed match).

**What the App Privacy answers should say** (none of it used for tracking):

| Apple category | What PongLens collects | Linked to the person |
| --- | --- | --- |
| Contact info | Email address, name | Yes |
| User content | Match and lesson video, photos, voice notes and lesson audio, notes and journal text, board posts | Yes |
| Identifiers | Account ID | Yes |
| Diagnostics | Device model, iOS version, hand-cut timings | Yes |
| Other data | Birth month and year, how they heard about PongLens | Yes |
| Purchases | Nothing in this version | n/a |

All of it is for app functionality. OpenAI and Deepgram receive content as
service providers, which Apple counts as collection by PongLens, not as
tracking.

---

## 4. After approval, not blocking

| # | Item | Status |
| --- | --- | --- |
| C1 | Website: replace "Get the iPhone beta" and the TestFlight sign-up panels on the home and coaches pages with an App Store link, and the "free during beta" lines | open |
| C2 | Re-ask the AI question when its wording changes. The version is saved but never compared, so today nobody is re-asked. | open |
| C3 | Recollect sends entries to OpenAI with no consent check. It is switched off; add the check before it is ever switched on. | watch |
| C4 | Close a coach's Stripe account when they delete their PongLens account | open |
| C5 | Report on coach notes and paid-review questions, like coach entries already have | open |
| C6 | In-app purchases go through review in a later version before `purchases_enabled` turns on | watch |

---

## 5. Legal

**United States**

| Item | Status |
| --- | --- |
| AH Labs LLC formed and named in the Terms and Privacy Policy | done |
| DMCA agent registered with the Copyright Office | done; the phone number is missing from the Terms page (A12) |
| Apple developer account converted to AH Labs LLC | requested 2026-09-25 (D5) |
| Minimum age 13 at sign-up | done; A10 closes the retry gap |
| A written process for an under-13 found later: move to a parent or delete | open |
| Texas and Utah age laws: read Apple's declared age range in a later build | open |
| Lawyer review of the Terms and Privacy Policy before calling it commercially launched | open |

**Europe, the UK and Switzerland:** not sold there, settled on 2026-09-15.
The website stays incidental (no euro pricing, EU ads, translations or
European testimonials). The app still enforces 16 in the EEA.

---

## 6. What the audit found already right

No need to touch these. Recorded so nobody re-checks them.

- **Payments.** The paid coach marketplace is switched off in the iPhone code itself, not only by a server setting, so no price, order or Stripe screen is reachable. "The app sells nothing" is true.
- **In-app AI features.** All ten routes that reach OpenAI or Deepgram refuse without permission, and the app shows the sheet and retries. Speech for called-out scores and lesson transcripts runs on the device.
- **Privacy manifest reasons, permissions and SDKs.** Every "required reason" API is declared; every permission has a real use and every use has a text; the only package is supabase-swift; no tracking, ads or analytics SDK.
- **Account deletion** is in the app and really deletes, media included.
- **Debug tools** (development sign-in, test routes, the theme gallery) compile only into debug builds. Admin screens check the server's admin flag, and neither review account is an admin.
- **Crashes.** No high-risk force-unwraps or fatal errors on network data were found.
- **Platform setup.** Encryption answered, no transport exceptions, icon has no transparency, the invite-link file on the website is correct, notifications never prompt.
- **Coach and student sharing.** Either side can remove the other, which stops the content both ways, and coach entries already carry a Report button.

---

## Done

### Upload rights confirmation is saved at the upload — 2026-09-18

Not an Apple rule. It is our own promise, and it was not being kept.

The checkbox says "I have the right to upload this video, including a
parent's permission for anyone under 18 in it." It used to save the moment
it was ticked, so somebody could tick it, close the app without uploading,
and be confirmed for good. Their first real upload then had nothing in
front of it. The words say "this video" and the behaviour was
once-per-account.

Now the tick is local and the confirmation is written when the upload
actually begins: at the shutter when recording a match, and at the point
the file is handed to the upload queue when importing a match or a lesson.
A tick that leads nowhere confirms nothing, and the box comes back next
time. It can also be unticked, because nothing is written until then.

Covered: iOS record, iOS match import, iOS lesson import, web match
upload, web lesson import (coach and player share one component).

### Terms at first run — guideline 5.1.1

"Agree and continue" on the first onboarding screen writes
`terms_accepted_at`. Enforced server-side: an account that never finished
onboarding cannot upload through the API.

### Account deletion — guideline 5.1.1(v)

Account deletion is in the app, in Account, and deletes rather than
deactivates.

---

## Watch

### One consent column covers coaches and players

`upload_confirmed_at` is one account-level answer. A coach who ticks it
while importing a lesson is also confirmed for match uploads, and the
other way round. That is deliberate, and it is fine while the wording
covers both. If the two sides ever need different words, they need
different columns.

### The audio lesson recorder asks no upload question

It asks the AI question instead, which is right: the audio is transcribed
and thrown away, never stored, so there is nothing uploaded to have rights
over. If that ever changes and the audio starts being kept, this recorder
needs the confirmation too.

---

## Reference

| Thing | Value |
| --- | --- |
| App ID | 6802642381 |
| Bundle ID | com.ponglens.PongLens |
| Version 1.0 | 6446d972-084e-44dc-bea2-99b4e258b989 |
| App Info | 7767966a-6ebf-449f-9a15-1f45f1ea1c8d |
| Review detail | 0c7f9553-30d9-47f2-ade5-0dec4d4ea25d |
| en-US listing | 49374097-e6b1-4939-a953-449514a6c363 |

Archive from a worktree cut from current `main`. The App Store Connect API
key cannot sign the upload; export with the Apple ID signed into Xcode
(`ios/PongLens/ExportOptions.plist`, `-allowProvisioningUpdates`).

## Log

**2026-09-26.** Five-part audit of the iPhone app at build 246: privacy,
payments, user content and minors, completeness, AI consent and platform
setup. Findings are sections 1 to 4. App Store Connect unchanged since
2026-09-18 except copyright; build 246 is processed but not attached.

**2026-09-18.** First pass over App Store Connect through the API. Category
set to Sports on 2026-09-15; build 208 attached then.
