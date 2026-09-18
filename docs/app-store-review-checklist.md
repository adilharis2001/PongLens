# App Store review checklist

Things App Review asks for that PongLens has to keep answering. Each item
says what Apple wants, what the app does today, and what is left. Add to
it whenever a gap turns up: the point of the list is that a gap found in
September is still on the page in January, rather than being rediscovered
by a rejection.

Status is one of **done**, **open** or **watch** (done, but it can rot).

---

## Open

### Report and block for shared content — guideline 1.2

**Apple asks for**, in any app where people see content other people made:
a way to report objectionable content, a way to block an abusive user,
published contact details, and action on a report within 24 hours.

**Today:** people do see each other's content. A coach reads a student's
entries; a student reads a coach's recaps; a public share link can be
opened by anyone who has it; the feedback board carries comments other
users read. There is no report control and no block control anywhere in
either app. Contact details are published (support@ponglens.com).

**Left to do:** a Report action on shared entries, shared recaps and
feedback comments, with somewhere for reports to land and be acted on; a
Block action between a coach and a student that stops the content both
ways. Both platforms.

**Why it matters:** this is the kind of thing a reviewer checks by opening
the app and looking for the button, and not finding it is a common
rejection. Nothing is broken for the people using PongLens today.

### The AI consent version never re-asks — guideline 5.1.2

**Apple asks for** permission before an account's content goes to another
company.

**Today:** the AI features sheet names Deepgram and OpenAI, is shown the
first time any feature needs it, is enforced by ten routes, and can be
switched off in Account. That part is sound. But `app_config`'s
`ai_consent_version` is stamped onto the row when somebody allows it and
then **never compared to anything**. `requireAiConsent` only asks whether
the flag is true.

**Left to do:** decide what a version change should do, and make it do it.
Nobody is in violation today, because the sheet describes the two vendors
correctly. The gap appears the moment a third vendor is added or one of
them starts doing something new: every existing account would keep its old
permission and never be asked again.

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
