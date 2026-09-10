# Coach management: one list, one page per coach

Design spec, 2026-09-10. Written after the owner found, on a new account, that
there was no way to invite his coach, no way to delete one, and almost nothing
on a coach's page.

Sources: five code reads, three competing designs, three judges and four
adversarial critics over the worktree at `origin/main` `ec999a08`. Every claim
below was checked against the real code or the real SQL. Where a critic
overturned the design, the spec says so inline, because the reason is worth
more than the conclusion.

---

## 1. What this is

A player has one list of coaches. Today that list is unreachable once it has
anything in it, half the actions on a coach are missing, and one of them is
impossible. This spec closes that, and fixes four database faults found while
specifying it that would have silently destroyed data the design promises to
keep.

It is one migration, a new roster screen on each platform, a rebuilt coach
page, and a shared decision module with a generated fixture so the two
platforms cannot drift apart again.

---

## 2. What exists today, and why it matters

Five separate faults, all live.

**Two buttons are labelled "Add a coach" and do different things.** The one in
the player Coaching tab's empty state mints a real invite link
(`CoachingScreen.swift:188`, `PlayerCoaching.tsx:439`). The one inside a lesson
composer's "Who taught it?" picker only writes a name into `player_coaches`
(`CoachPickerRow.swift:90`, `CoachPicker.tsx:170`). Using the second makes the
coach list non-empty, which permanently hides the first. That is exactly how
the owner ended up stuck: he wrote down "Kory", and the only invite door in the
app disappeared.

**On iOS the only remaining invite door is inside a match.** `MatchTools.swift`
`CoachInviteSheet`, reached from a match's Tools row. A new player with nothing
uploaded cannot invite a coach at all.

**On web the roster page is orphaned.** `/coaching/coach` has a permanent
"Add a coach" button and a waiting-invites section, but the only in-app link to
it is that same empty-state card (`PlayerCoaching.tsx:440`, verified: no other
link exists). Account's "Your coaches" row points at `/coaching`.

**Neither platform can remove a written-down coach.** "Remove coach" is wired
to `leave_coach`, which ends a coach's *access*, and is gated on having real
`coach_links`. A written-down coach has none, so the button is hidden and the
row is permanent. Nothing in `src/` or `ios/` writes `player_coaches.archived_at`.

**There is no way to invite a coach already on the list.** The invite sheet
always starts from a blank name. `nameCoachInvite` does find-or-create on
unbound names, so typing the identical name would adopt the row, but nothing
says so, and typing a name that is already *invited* silently overwrites
`invite_id` and strands the first invite.

None of this is a backend limit. `"Players manage own coaches"` and
`"Players manage own coach links"` are both `for all` on
`player_id = auth.uid()`. Every gap is a missing button.

**Where the gap came from.** The 2026-09-07 player-coaching-workspace spec
specified the coach page in full, including Copy link, Revoke, access controls,
Share a match and Remove coach. Both platforms implemented it faithfully. The
spec simply assumed an invite is always minted somewhere else and never
specified an action that starts from a coach already on the list. The gap is in
the spec, not in the implementation.

---

## 3. The model

Three sentences an implementer should be able to recite:

- **The list is the player's, and only the player takes someone off it.**
- **A coach's page is the single place a coach is managed.**
- **An invite is bound to a row by id, never matched by name.**

A coach gets on the list two ways: the player writes down a name while filing a
lesson, or the player invites someone. Wherever a coach came from it is the
same list, and every coach on it has one page. The list lives behind one
permanent row on the Coaching tab called **Your coaches**, and that page
carries the one permanent **Add a coach** button in the product. Nothing about
a coach is reachable only from inside a match, and nothing is reachable only by
typing a URL.

---

## 4. Decisions

### 4.1 The colliding labels

"Add a coach" comes to mean one thing: mint an invite.

| Control | Today | Becomes |
|---|---|---|
| Coaching tab empty state | web navigates to a page reading "No coaches yet"; iOS opens the invite sheet | **Add a coach**, opening the invite composer on both |
| Roster header | small secondary pill, web only | **Add a coach**, the one cyan primary on the roster, both platforms |
| Lesson picker | `coaches.isEmpty ? "Add your coach" : "Add a coach"` | **New coach**, one label, no empty-list variant |
| Naming a waiting invite | **Add a name** (web only) | **Add a name**, unchanged, both platforms |

The picker's new word is **New coach**, not "Add a name". A critic caught that
"Add a name" is already taken, and correctly: it means *put a name on a waiting
invite*, which is a different object one tap away. Three labels, three
meanings, no overlap.

The discoverability the picker was carrying by accident is replaced
deliberately: a name written there now appears on **Your coaches** reading
**Not on PongLens**, and their page leads with **Send an invite**.

### 4.2 Where the permanent door lives

**One row on the Coaching tab, both platforms, opening one roster at
`/coaching/coach`.**

The chips filter the feed. They are not a roster, they carry no standing and no
actions, and under "All" there is no way into anything. The row sits under the
chips, reads **Your coaches**, carries a trailing **1 invite waiting** when any
pending invite exists, and has a chevron.

Visibility is one shared function,
`coachingTabDoor(coaches, pendingInvites, state)`, called by both platforms,
returning `"row" | "empty" | "loading" | "error"`. Exactly one of the row and
the first-run card is on screen once loaded, in every state. That function is
what stops this bug re-opening: today the rule is `coaches.length === 0`
written twice in prose, and the next person to touch the empty-state gate can
re-hide the only invite door exactly as it is hidden now.

The test counts pending invites as well as coaches. A player whose only
artefact is a legacy unnamed invite would otherwise see the first-run card and
still have no way to reach the invite.

**The fourth state is not decoration.** A critic found that neither platform
can currently tell a failed load from an empty one: `CoachingStore.load()` does
`playerCoaches = named ?? []; loaded = true` on a swallowed error
(`CoachingStore.swift:109-118`), and `fetchLinks` has no error branch
(`SharingSection.tsx:268-271`). With a two-state door, one dropped request
re-hides the invite button and shows "No coaches yet" to a player who has six.
Both stores must hold the previous list and raise a failure flag instead of
coercing to `[]`. See §8.

**No new web route.** `/coaching/coach` and `/coaching/coach/<id>` are already
first in `PLAYER_COACHING_PREFIXES` (`workspaceModel.ts:63`), ahead of the
`/coaching/` catch-all that gives everything to the coach side. Reusing them
means the territory rule needs no edit, and that rule has been broken from both
directions twice. Do not invent `/coaching/add`.

**On iOS**, a new `struct CoachRosterRoute: Hashable {}` beside `CoachPageRoute`
and registered in `MainTabView`. **Not** in `AppRouteDestination`: that
registrar is shared with the coach workspace root.

Two doors that point at the wrong place today are corrected, because they are
where a person looks: Account's "Your coaches" goes to `/coaching/coach` on web
and pushes the roster on iOS.

**A critic caught a hole in that last line.** `AccountScreen` is reached through
the shared registrar and renders inside *both* iOS roots
(`MainTabView.swift:130`, `CoachTabView.swift:127`), so a row that pushes a
player-only route would be a silent no-op in coach mode. The iOS row therefore
calls `app.setWorkspace(.player)` and then routes, so it is correct in either
root. Same requirement on web.

### 4.3 Removal is an archive, and there are two removal-shaped actions

**Archive. Always, uniformly, through an RPC. No client may delete a
`player_coaches` row, and the DELETE grant is withdrawn so none can.**

Both foreign keys onto that row are `on delete set null`, and since
`20260907160000_unlinking_a_coach_clears_the_name.sql:23-31` that null reaches
`lessons` as an UPDATE which fires `lessons_coach_normalise` and **blanks
`coach_name`**. One client-side delete would turn every "Lesson with Jonathan"
into "Note", permanently, on both platforms and on any share link already
published, and would drop `lesson_videos.coach_ref_id` with nothing left
recording who the recap was with.

`archived_at` already exists and is already read in eight places. It is written
by nothing. The read side of the archive was finished before this work started.

Two buttons, not one:

- **End their access** — connected only. Revokes every link. The coach stays on
  the list and reads **No longer connected**.
- **Remove from your list** — every standing. Archives.

Collapsing these into one would delete a real shipped capability: stop them
watching, keep them on the list, keep training with them. Two removal-shaped
buttons cannot both be called "Remove", and each of these names its own effect
in words a player would use.

**Because it is an archive, it can be undone.** A **Removed coaches**
disclosure at the bottom of the roster with **Put back** on each row. Without
it, `archived_at` is a one-way trip the player can neither see nor reverse,
which is a worse deal than the delete it replaces.

**Entries keep saying who taught them.** `coach_name` survives archiving;
`shared_with_coach_at` is cleared, so the coach stops reading them. Cards keep
the name, the picker stops offering the coach. That asymmetry is deliberate and
is already written into three migration headers in this codebase's own words:
you stopped working with them, you did not stop having had the lessons. The
confirmation copy says so before the tap.

### 4.4 Inviting binds by id, never by name

The invite is attached with
`update player_coaches set invite_id = <new link> where id = <that row>`. No
name matching, no find-or-create, so a duplicate is arithmetically impossible
and whitespace, casing and renames have nothing to get wrong.

This also fixes the past-coach case. `nameCoachInvite` filters
`coach_id === null`, so today inviting a past coach mints a second
identically-named row that only self-heals if they accept. Pointing the past
row's `invite_id` at the new pending link makes it read **Invite waiting**
immediately, because `player_coaches_list`'s `invited` branch is evaluated
before the `past` fall-through.

`nameCoachInvite` / `CoachingStore.nameInvite` survive for one job: putting a
name on a legacy unnamed invite. Two faults get fixed while there:

- **Platform divergence.** iOS writes only `invite_id`
  (`CoachingStore.swift:152`); web writes `{invite_id, display_name}`
  (`nameInvite.ts:46`). Both must write the typed name **and**
  `name_from_account: false`, or the next account rename silently overwrites
  the player's wording.
- **It can strand a live invite.** A critic found that the helper matches any
  row with `coach_id === null`, which includes rows already reading *Invite
  waiting*. Naming a second unnamed invite "Dave" re-points Dave's row at it
  and leaves the first invite pending, unnamed and holding a stranded
  `coach_invite_matches` queue. The guard therefore lives **in the shared
  helper, not in the composer's UI**, so every caller inherits it, including
  the iOS match sheet: refuse when `invite_id` already points at a pending
  link.

### 4.5 The invite name stays optional

Requiring it is tidier and is rejected. It reverses a correction the owner
drove himself in migration 164: he skipped the optional field, asked why the
row said "Invite link", and the rule that came out of it was that an unnamed
invite reads "Unnamed invite" and **a name must be addable after the fact, not
demanded up front**. It also puts friction into the match-page quick share,
which is the hurried flow.

What was missing was not a requirement. It was that an unnamed invite has no
`player_coaches` row, therefore no chip and no page, and **on iOS today it
cannot be seen or revoked at all**. The roster fixes that by listing pending
links nobody has named, with **Copy link**, **Add a name** and **Revoke**.

**Copy link stays on that row.** A critic caught that dropping it makes a link
unrecoverable: mint an invite without a name, close the sheet before sending
it, and there is no way on any surface to see the URL again.

### 4.6 Rules that exist once, not twice

Every read found the same failure shape: a rule written twice, wrong the same
way in both or wrong differently. New pure module
`src/lib/coaches/coachActions.ts` (no React, no Supabase) with the Swift twin
`ios/PongLens/PongLens/Core/CoachActions.swift`, owning:

- `coachingTabDoor(coaches, pending, state)` — §4.2
- `coachAccessLine(coach, links)` — the same rule written twice today
  (`PlayerCoaching.tsx:351`, `CoachingScreen.swift:335`), with the web-only
  suppression now applying on both. The phone prints "Not on PongLens · Not
  connected", the sentence web deliberately deleted for saying one fact twice.
- `canSendInvite(coach)` — `offline || past`. Gates a button on four surfaces.
- `matchExistingCoach(rows, name)` — duplicate recognition, including the exact
  sentences.
- `removeConfirmMessage(coach)` and `endAccessConfirmMessage(coach)`
- `sortCoaches`, moved from `playerCoaches.ts:108`, so chip order stops
  differing between platforms.

A **generated** fixture `ios/Tests/fixtures/coach-actions.json` holds the
TypeScript module's own output over every standing crossed with every link
shape. This is the device the project already trusts for `serve-parity.json`,
and it is the only anti-drift mechanism here that works without anyone
remembering it: **a state added on one platform fails the other platform's
test.**

**How that test is actually built.** A critic checked and there is no XCTest
target for this. `ios/Tests/run.sh` is a plain `swiftc -O` build over named
`Core/*.swift` files that import Foundation and nothing else, with a
`main.swift` calling each `runXChecks()` by name. So: the row models move into
a new Foundation-only `Core/CoachModels.swift` (imported by `JournalStore` and
`CoachingStore`), `Core/CoachActions.swift` and `Core/CoachModels.swift` join
the `swiftc` list in `ios/Tests/run.sh`, `CoachActionsTests.swift` sits beside
the other cases, and `runCoachActionsChecks()` is registered in
`ios/Tests/main.swift`. The word XCTest does not appear.

**One list source.** Every surface reads `player_coaches_list()`.
`player_coach_links()` stays, but only for link facts. This is why the web
roster is rebuilt rather than linked to, and it ends the live bug where one
feed row says "Shared with Jonathan" on web and "SHARED WITH JONATAN MCDONALD"
on the phone.

---

## 5. The database

The feature needs no schema change. The safety around it needs six, four of
which are pre-existing faults that this work would otherwise trip.

One migration, `supabase/migrations/<ts>_player_coach_removal.sql`.

### 5.1 Both deletes in `player_coaches_revoke_sync` stop deleting

**This is the blocker the critics found, and it reverses a decision the design
made.** The design promised that "End their access" leaves the coach on the
list reading **No longer connected**. It cannot, today. `leave_coach` updates
`coach_links.status`, which fires `player_coaches_revoke_sync`, whose second
delete is:

```sql
delete from public.player_coaches pc
 where pc.player_id = new.player_id
   and pc.coach_id  = new.coach_id
   and not exists (select 1 from public.lessons l where l.coach_ref_id = pc.id);
```

So ending access to a coach you have no lessons with **destroys the row**. An
`archived_at is null` guard does not help: the row is live at that moment,
which is precisely when the delete fires.

The same delete is reached from the *coach's* side. `remove_student` revokes
the coach's links, so a coach tidying their roster silently removes themselves
from the player's list, contradicting "only the player takes someone off it".

Therefore:

- **The second delete is removed.** Migration 168 already added the `past`
  branch to `player_coaches_list`, which renders exactly the state the delete
  was there to avoid. `canReceiveEntries` is already false for `past`, so the
  original complaint behind 165 (revoked coaches sitting in the "Who taught
  it?" picker offering to receive entries) stays closed.
- **The first delete becomes `update player_coaches set invite_id = null`**,
  narrowed by `invite_origin_id` (§5.3). Revoking an invite stops the link
  working; it does not reach into the player's list.

This is a retroactive behaviour change and it is deliberate: from this
migration on, revoking never removes a coach from anyone's list. It is called
out in §13 as a decision for the owner.

### 5.2 `remove_player_coach` and `restore_player_coach`

Both `security definer`, `set search_path = public`, execute revoked from
`public, anon`, granted to `authenticated`.

**`remove_player_coach(p_id uuid)`, one transaction, in order:**

1. `v_me := auth.uid()`, else raise. Row must exist with `player_id = v_me`,
   else raise.
2. **Lock before reading.** `select ... for update` on the `player_coaches` row
   and on the `coach_links` row its `invite_id` points at, in that order after
   `coach_links` — the same lock order `accept_coach_invite` uses, so the two
   cannot deadlock. A critic found the unlocked version loses a race: the coach
   accepts mid-call, the row gains `coach_id`, and step 4 branches off a stale
   snapshot, leaving the coach with full match access and no row on screen.
3. `update player_coaches set archived_at = coalesce(archived_at, now())`.
   First, so nothing downstream can destroy the row. This also fires the
   archive branch that clears `shared_with_coach_at` on their entries.
4. Revoke **every** pending link this removal should end, not only the one
   `invite_id` names: a row can hold more than one, because the match sheet
   mints links and adopts rows by name. For a bound row `leave_coach` covers
   them; for an unbound row, revoke `invite_id` plus any pending link whose
   `invite_origin_id` is this row.
5. When `coach_id` is set (re-read from the locked row, not the step-1
   snapshot), `perform public.leave_coach(v_row.coach_id)`. Reuse it rather
   than restate it, so `coach_students`, the link revocations and the
   `shared_with_coach_at` clear all happen exactly as they do today.

**`restore_player_coach(p_id uuid)`** un-archives. On collision with a live row
for the same non-null `coach_id` (`player_coaches_linked_uniq` is partial on
`archived_at is null`) it must **not** simply refuse: a critic showed that
refusing strands the archived row's lessons where neither Put back nor merge
can reach them. Instead it does what `merge_player_coaches` does, definer-side,
which is safe because both rows belong to the same account: move `lessons` and
`lesson_videos` onto the live row and leave the archived row archived. The
client says **Their lessons moved onto the Jonathan already on your list.**

**Restoring does not revive an invite.** A critic enumerated the four
outcomes: a removed *offline* or *invited* row both come back reading **Not on
PongLens**, because step 4 revoked the link and the `invited` branch needs a
pending one. So the remove confirmation for an invited coach says the invite
stops working, and after a restore the coach page shows one line, **The invite
you sent them was cancelled. Send a new one.**, above **Send an invite**.

### 5.3 `invite_origin_id`

`player_coaches.invite_origin_id uuid references coach_links(id) on delete set null`,
**with no backfill**. Written only when the invite flow *creates* a row, never
when it adopts or binds one.

Today "I wrote Dave down, invited Dave, changed my mind, revoked, Dave
disappeared" is real behaviour, because 165's justification is true of rows the
invite *created* and false of rows it *adopted*, and no column has ever
separated them.

**No backfill is load-bearing.** Setting it wherever `invite_id` is not null
would mark every already-adopted row as invite-created and preserve the exact
bug the column exists to fix.

**It needs a writer, and the design forgot one.** The insert branch of
`nameCoachInvite` (`src/lib/coaches/nameInvite.ts:51-56`) and
`CoachingStore.nameInvite` (`CoachingStore.swift:161-172`) both gain
`invite_origin_id: inviteId` beside `invite_id`.

### 5.4 The fold in `player_coaches_sync` moves recordings too

`167:79-83` moves `lessons` and nothing else, then deletes the row.
`lesson_videos.coach_ref_id` is `on delete set null`, so the delete silently
drops it. `merge_player_coaches` was fixed for exactly this on 2026-09-07; the
fold was missed. The new "Send an invite" from an offline row is the shortest
path to hitting it.

Add `update public.lesson_videos set coach_ref_id = v_bound where coach_ref_id = v_named;`
before the delete, and the same in 167's backfill loop.

**State the rule once, in the migration header:** every statement in this
schema that deletes a `player_coaches` row must move both `lessons` and
`lesson_videos` first, or be guarded so it cannot fire.

### 5.5 `publish_lesson_video` accepts an archived row

It currently raises "This coach is no longer on your list." Without this,
removing a coach silently traps any unpublished recap filed under them, for
ever, with no way out. Publishing a recap is the player's own record of a
lesson that happened; `lesson_video_access` still excludes archived rows, so
the coach really does lose access.

### 5.6 The grant, and the archived list

`revoke delete on public.player_coaches from authenticated;` Nothing in either
tree issues a delete today (verified). A future implementer who reaches for one
now gets a loud permission error instead of silently blanking names.

**`player_coaches_archived_list()`** — new, same return shape as
`player_coaches_list()`, `where archived_at is not null`. A critic found the
design specified a "Removed coaches" section with no data source at all:
`player_coaches_list` ends `and pc.archived_at is null` and returns no
`archived_at` column. This is a new function, so the existing one keeps its
return shape and neither platform's decoder changes.

`player_coaches_list()` itself is unchanged.

---

## 6. Screen by screen

### 6.1 The Coaching tab, both platforms

- A permanent **Your coaches** row under the chips, trailing **N invites
  waiting** when any exist, with a chevron. Governed by `coachingTabDoor`.
- The empty-state button becomes **Add a coach** and opens the invite composer
  directly on both platforms. On web this also removes an absurdity: pressing
  "Add a coach" and landing on a page whose entire content is "No coaches yet."
- The chip row renders only when there are at least two filters. With one coach
  and no coachless items, "All" and "Dave" filter to the same thing.

### 6.2 The roster

**Web, `/coaching/coach`.** `src/app/coaching/coach/page.tsx` keeps its
`← Coaching` link, its `<h1>Your coaches</h1>` and its `AppShell`, and renders
a new `src/components/CoachRoster.tsx` instead of `SharingSection` in list
mode.

Rebuilt rather than linked to, because `SharingSection`'s list is built from
`player_coach_links()` — accepted links plus pending invites. A coach the
player only wrote down has neither, so today that coach appears nowhere on this
page. The page cannot be the home for written-down coaches while it is built on
links.

Top to bottom:

1. **Add a coach** — the one cyan primary,
   `glow-cta rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink`,
   `w-full sm:w-auto`. Drop the current uppercase **Coaches** eyebrow: the
   `<h1>` two lines up already says it.
2. **The list.** One card, rows divided, ordered by `sortCoaches`. Each row is
   a `<Link>` with the initials avatar, the name, the standing line under it,
   and a chevron. The standing line is `coachStanding(c)` plus the access line
   **only when `c.coach_id` is set**.
3. **Legacy unnamed invites**, appended to the same card, for pending links no
   coach's `invite_id` points at. Name **Unnamed invite** in muted text,
   sub-line **Invite waiting**, and three pills stacked full-width on mobile:
   **Copy link**, **Add a name** and **Revoke**.
4. **Removed coaches**, only when at least one archived row exists. A
   disclosure with the count, expanding to a name per row with a **Put back**
   pill. Fed by `player_coaches_archived_list()`.
5. **Empty:** one line, **No coaches yet.**

`SharingSection.tsx`'s entire list branch is deleted, and `AccessPair` and
`CoachManageRows` move to `src/components/coach/` and are exported rather than
re-implemented.

**iOS, new `Screens/CoachRosterScreen.swift`.** Built in the Coaching tab's
grammar, not as a `Form`, because the owner's instruction is that it feel like
the coaching tab: `ZStack` → `ArenaBackground()` → `ScrollView` → `VStack`
with `.padding(20)`, matching `CoachPageScreen.swift:96-127`. Back pill
**Coaching**. Title **Your coaches** in `.plPageTitle`. **Add a coach** in
`PLPrimaryButtonStyle`, with the label sized
(`Text("Add a coach").frame(maxWidth: .infinity, minHeight: 28)`) **before**
the style is applied, so the hit area grows with the visible button. One
`.plCard(padding: 16)` per coach, each a `NavigationLink(value:)` — the card
`CoachingScreen.coachCard` already draws, minus the "Manage" text, since in a
list where every row navigates the word on every row is noise. Unnamed invites,
**Removed coaches** under a `SectionHeading`, and the same one-line empty
state.

### 6.3 A coach's page

Web `/coaching/coach/[id]` and iOS `CoachPageScreen.swift`. The web back link
becomes **← Your coaches**, so the hierarchy reads Coaching → Your coaches →
Jonathan. The iOS back pill's label becomes a parameter: **Coaching** from the
tab, **Your coaches** from the roster.

In order: the standing line (unchanged); **Send an invite** when
`canSendInvite`, cyan primary, directly under it; the invite box when the
standing is `invited`; **Revoke** under the box; the access pair, what they can
see and Share a match, unchanged; **Lessons**, unchanged; then **Manage**:

- **Rename in your journal** and **Same as an existing coach**, unchanged.
- **End their access** — connected only. Title **End their access?**, body
  **They stop seeing your matches and the entries you shared with them. They
  stay on your list and your lessons keep their name.**
- **Remove from your list** — every standing. Title **Remove Jonathan from your
  list?**, body by standing:

  | Standing | Body |
  |---|---|
  | connected | They stop seeing your matches and the entries you shared with them. Your lessons keep their name. |
  | invited | The invite stops working and cannot be restarted. Your lessons keep their name. |
  | offline, past | Your lessons keep their name. |

  Buttons **Remove** and **Cancel**; **Removing…** while the RPC runs.

"Your lessons keep their name" replaces the shipped "Your lessons are kept".
The thing a player fears losing is the name on the card, not the card.

iOS uses `.confirmationDialog`, which this screen already uses. Web uses the
same two-step rendered inline the way `CoachManageRows` already expands — not a
second press of the same button changing meaning under the cursor.

**An archived coach's page no longer 404s.** `coach/[id]/page.tsx:45` currently
does `if (!coach || coach.archived_at) notFound()`. Since removal now sets
`archived_at`, that turns Back, a second open tab and every bookmark into a
generic not-found page. It renders a removed state instead: the name as the
heading, one line — **You removed them from your list.** — and a **Put back**
pill. No access controls, no Manage.

**Afterwards**, both platforms land on **Your coaches**, because that is where
**Put back** is. iOS reloads **both** `CoachingStore` and `JournalStore`, which
hold independent copies of `player_coaches_list()`; refreshing one leaves a
removed coach in the lesson picker, which is what `CoachingStore.renameCoach`
gets wrong today.

### 6.4 The invite composer

**Web, `src/components/ShareWithCoach.tsx`.** Structurally unchanged. Four
edits.

1. **New props** `coachRefId?` and `title?`. Three callers, three honest
   titles: **Add a coach** (roster, empty state), **Send an invite** (coach
   page), **Share with coach** (match tools, unchanged).
2. **Bound mode**, when `coachRefId` is given: no name field. The box's first
   line becomes **Jonathan can watch, but not edit. They can add notes.** The
   starter pack's journal half is enabled immediately, since a bound row is an
   attributable coach. **Invite someone else** does not appear.
3. **It must load the coach list in every mode.** `loadCoaches` currently
   short-circuits with `setCoaches([])` whenever there is no `matchId`
   (`:88-93`), which a critic showed makes duplicate recognition impossible on
   the two surfaces it is specified for. It fetches `player_coaches_list()`
   whenever the sheet is open. Recognition is advisory: nothing renders while
   the fetch is in flight, no error line if it fails, and the primary stays
   enabled throughout.
4. **Duplicate recognition in new-coach mode**, as the player types, from
   `matchExistingCoach`. One line under the field:

   | Existing row | Line | Primary becomes |
   |---|---|---|
   | offline or past | Jonathan is already on your list. This invite goes to them. | **Create invite link**, targeting that row by id |
   | invited | Jonathan already has an invite waiting. | **Open their page** |
   | connected | Jonathan is already connected. | **Open their page** |

**Create-then-attach is two writes.** Bound mode raises the stakes, because
with no name field a failed second write leaves a live pending link attached to
nobody and invisible on the roster. On failure, revoke the just-created link
before returning and show **Couldn't create the link. Try again.**

**iOS**: `AllMatchesCoachInvite` moves out of `CoachingScreen.swift` into
`Screens/CoachInviteComposer.swift`, taking `coachRefId` and `title`, rebuilt
on `PLSheetScaffold` rather than hand-rolling the NavigationStack, tint, title
and Done it re-implements today. The scope control stays a segmented `Picker`
with the explanation in the section footer: that is iOS's own form of the web's
two tiles and is already the shape on `CoachPageScreen`.

### 6.5 The invite box

The box the owner means is `ShareWithCoach.tsx:703-745`, the after-create half:
one bordered card holding the sentence, the link, the actions and the QR.
Today it exists only in the seconds after a link is minted. A coach with a
waiting invite gets a bare "Copy link" pill instead, which is exactly where a
player goes looking for it.

**Extract it verbatim** into `src/components/InviteLinkBox.tsx`
(`{ url, sentAt?, onInviteAnother? }`) and the twin
`ios/PongLens/PongLens/Components/InviteLinkBox.swift`, built from `plCard` /
`plInnerRow` and `PL` tokens rather than a `Form`. Same contents, same order,
on all four surfaces:

```
It is waiting until they open it. You can revoke it any time.
Sent on 3 March.
https://www.ponglens.com/coach-invite/…
[ Copy link ]   [ Share the link ]
Show QR
```

Then the QR with its existing caption **Scan to open**, and **Invite someone
else** in new-coach mode only.

Four divergences this settles:

- The sentence loses its destination. It says "…from **Coaching**" on web and
  "…from **Account**" on iOS, for a screen that no longer manages this. **Two
  variants, one shared constant**, because a critic pointed out the box now
  appears where there is no Revoke: on a coach's page, **You can revoke it any
  time.**; everywhere else, **You can revoke it from their page under Your
  coaches.**
- One label for the native share: **Share the link**, the plainest of the three
  in use.
- **Copy link** exists everywhere, including the match sheet. This reverses the
  deliberate omission at `MatchTools.swift:774-779`, whose premise held on one
  of the three surfaces that show this box. A duplicated control is not a harm;
  a freshly minted link with no way to copy it is.
- **The component owns its own copy failure.** The two existing handlers
  disagree — one sets a message, one silently does nothing. It renders
  **Copy failed. Select the link and copy it manually.** below the action row,
  which is also why the link stays a selectable wrapping block rather than a
  truncated one.

**The two iOS invite sheets are not merged.** `CoachInviteSheet` lives inside a
1,658-line file and every section of it is written against `match.id`. Sharing
the box gets most of the label-divergence fix for a fraction of the risk.

### 6.6 Everything else that moves

- **Lesson picker**, both platforms: label **New coach**, field placeholder
  **Their name**, confirm **Add**. No explanatory line under the field.
- **Account**, iOS: the coaching summary counts accepted `coach_links`, so one
  coach with three shared matches reads "3 coaches connected" and a player with
  written-down coaches reads "No coaches yet". Count `playerCoaches` by
  standing instead.
- **The "your coach accepted" notification**, `accept_coach_invite`, currently
  `href = coalesce('/match/'||scope, '/coaching')`. A critic found that a bare
  `/coaching` matches none of the three prefixes the iOS coach root handles, so
  a dual-role account sitting in coach mode taps the notification and nothing
  happens. Point it at `/coaching/coach`, which is player territory and
  therefore flips the side the same way `/coaching/students` already does for
  the coach's own bell, and add a `/coaching/coach` branch to both iOS roots.

---

## 7. Behaviour table

| | **offline** | **invited** | **connected** | **past** |
|---|---|---|---|---|
| Standing words | Not on PongLens | Invite waiting | Connected | No longer connected |
| Roster sub-line | standing only | standing only | `Connected · <access>` | standing only |
| Counted in "N invites waiting" | no | yes | no | no |
| Coach page primary | **Send an invite** | none, the box is the content | none | **Send an invite** |
| Invite box + **Revoke** | no | yes | no | no |
| Access pair | no | yes, when the pending link is not match-scoped | yes | no |
| What they can see | no | yes, what is queued | yes | no |
| Share a match | no | yes, unless all-matches | yes, unless all-matches | no |
| Lessons | yes | yes | yes | yes |
| Rename / Same as | yes | yes | yes | yes |
| **End their access** | no | no | yes | no |
| **Remove from your list** | yes | yes | yes | yes |
| Remove revokes | nothing | every pending link for the row, emptying queued matches | every link, via `leave_coach` | nothing |
| Remove archives the row | yes | yes | yes | yes |
| Put back returns them as | Not on PongLens | Not on PongLens, with the cancelled-invite line | No longer connected | No longer connected |
| Offered in "Who taught it?" | yes | yes | yes | yes, marked `· past` |

**Two accepted quirks**, stated so they are not later found as bugs: sharing a
single match with someone makes them read **Connected**, because the standing's
first branch counts any accepted link; and an invite link is multi-use until
revoked, so two people opening one link both get in and the second gets none of
the queued matches. Neither is new; the roster just makes them visible.

---

## 8. Failure, empty and loading states

The design gave busy copy and one refusal string. A critic found no failure
copy for any new action, and iOS helpers that swallow errors and return Void
(`CoachingStore.revokeLink` is `_ = try? await …`). The contract:

- `removeCoach`, `restoreCoach` and `attachInvite` **return Bool on iOS** and
  surface an error on web, like `rename`, `merge` and `setAccess` already do.
- Strings, in the house shape: **Couldn't remove them. Try again.** /
  **Couldn't end their access. Try again.** / **Couldn't put them back. Try
  again.** / **Couldn't create the link. Try again.** (exists) /
  **Couldn't load your coaches. Try again.**
- Each renders in the coach page's existing `errorMessage` slot on iOS and the
  `mt-3 text-sm text-red-400` line on web. Buttons re-enable on failure.
- **The load has three outcomes, not two.** `loaded` becomes tri-state, or
  gains a `loadFailed` flag. `coachingTabDoor` returns `"error"`, which renders
  the **Your coaches** row (never the first-run card) plus the failure line and
  a **Retry** pill. `CoachingStore.load` stops coercing `try?` failures into
  `[]`; `fetchLinks` gains an error branch.
- Empty states are one line each: **No coaches yet.** and **No lessons with
  them yet.** (both already exist).

---

## 9. Surfaces

### Database
One migration: `remove_player_coach`, `restore_player_coach`,
`player_coaches_archived_list`, `invite_origin_id` (no backfill), both deletes
in `player_coaches_revoke_sync` neutralised, `lesson_videos` added to
`player_coaches_sync`'s fold and to 167's backfill loop, `publish_lesson_video`
accepting an archived row, `accept_coach_invite`'s notification href, and the
DELETE grant withdrawn.

### Web
`PlayerCoaching.tsx` · `CoachRoster.tsx` (new) · `coaching/coach/page.tsx` ·
`coaching/coach/[id]/page.tsx` (archived state, not 404) · `CoachPage.tsx` ·
`SharingSection.tsx` (list branch deleted, focus mode gains the new actions) ·
`components/coach/AccessPair.tsx` + `CoachManageRows.tsx` (moved out) ·
`ShareWithCoach.tsx` · `InviteLinkBox.tsx` (new) ·
`lib/coaches/coachActions.ts` + test (new) · `lib/coaches/inviteCoach.ts`
(new) · `lib/coaches/nameInvite.ts` (writes `invite_origin_id`, guards a live
invite) · `lib/coaches/playerCoaches.ts` · `journal/CoachPicker.tsx` ·
`account/page.tsx` · `lesson-video/[id]/page.tsx` (up-link must not point at a
page that 404s for an archived coach) · `learn/playerGuides.ts` ·
`lib/qa/testLibrary.ts` · `package.json` (wire `workspaceModel.test.ts`, which
asserts the territory rule and is run by nothing today).

### iOS
`Screens/CoachRosterScreen.swift` (new) · `Screens/CoachInviteComposer.swift`
(new) · `Components/InviteLinkBox.swift` (new) · `Core/CoachActions.swift` +
`Core/CoachModels.swift` (new, Foundation-only) · `CoachingScreen.swift` ·
`CoachPageScreen.swift` · `MatchTools.swift` · `CoachingStore.swift` ·
`JournalStore.swift` · `CoachPickerRow.swift` · `MainTabView.swift` ·
`CoachTabView.swift` (the `/coaching/coach` bell branch) · `AccountScreen.swift`
(count by standing; **Your coaches** sets the workspace then routes;
`CoachLinksManager` deleted) · `Screens/CoachAccessList.swift` **deleted** — it
is unreachable and built on `coach_links`, so resurrecting it would reproduce
the exact "written-down coaches appear nowhere" defect the roster exists to
fix. `CoachSharedWith` stays; it is live. Inside `CoachHubView.swift`, which is
mostly dead, `CoachOrderRowView` and `CoachOrderRoute` are live and must not be
swept up.

### Generated assets
`npm run learn:ios` and the regenerated
`ios/PongLens/PongLens/Resources/learn-catalog.json` — the Learn guide sentence
lives in the iOS bundle too, and `learn:ios:check` fails when it is stale.
`scripts/demos/tutorial/flows/player/coach.mjs` and `player-flows.test.mjs`
both drive and assert `text=Add a coach` on `/coaching` and the sheet title
"Share with coach", so both break on this change.

### Worker
Untouched. `grep player_coaches worker/` is empty and stays empty.

---

## 10. Order of work

Each step shippable on its own:

1. Migration.
2. Shared decision module and the generated fixture, both platforms.
3. Web roster and coach page.
4. Web composer and the invite box.
5. iOS roster and coach page.
6. iOS composer and the invite box.
7. Label changes, Learn guide, QA cases, tutorial flow.

---

## 11. Verification

- Desktop web at 1280×850 and **mobile web at 393×660**, not 844, with the
  roster at eight coaches plus a removed section, and the coach page in each of
  the four standings clearing the fold.
- iOS in the simulator, checking each full-width button's hit area grew with
  its label.
- **The coach's own side**, because `student_shared_lessons()` and
  `lesson_video_access()` change under a coach the instant a player removes
  them: sign in as a coach and confirm the entries go and nothing errors
  mid-session.
- The real `npm run build` in a worktree with its own `.next` and a copied
  `.env.local`, `tsbuildinfo` deleted first.
- `npm run test:journal`, the new `coachActions` test, `ios/Tests/run.sh`,
  `npm run learn:ios:check`, `npm run test:tutorial`.
- New QA cases in `src/lib/qa/testLibrary.ts` under "Sharing and coach access":
  invite a coach already on the list; remove and put back each standing; revoke
  and confirm the coach stays on the list.

---

## 12. Out of scope

1. No hard delete anywhere, and the grant is withdrawn.
2. No required invite name.
3. No swipe-to-delete and no remove on a roster row. One destructive action,
   one place, one confirmation.
4. No separate "Archived coaches" screen. One disclosure at the bottom.
5. No per-coach access controls on roster rows.
6. No new web route, and no player-side route in `AppRouteDestination`.
7. No merge of the two iOS invite sheets.
8. No change to the scope sets (web offers three tiles with a match, two
   without; iOS offers two). Squaring them is a separate argument.
9. No invite expiry, reminder or resend. **Share the link** again is the
   resend.
10. Archived coaches never appear in the picker. Put them back first.
11. Not fixing the three clients that delete accepted `coach_links` rows
    instead of revoking them (`CoachSharedWith.tsx:142`,
    `ShareWithCoach.tsx:177`, `MatchTools.swift:1037`). Real and pre-existing.
12. Web's two bare `<select>` coach pickers keep their no-create behaviour
    where iOS uses the full picker. Real inconsistency, separate job.
13. Tutorial chapter 8 is **not** re-recorded. Its narration stays true; its
    capture shows the old flow until someone re-runs it. Flagged, not fixed.

---

## 13. Decisions for Adil

1. **Revoking an invite will stop removing a coach from your list.** Today,
   revoking an invite to someone you have no lessons with deletes them from
   your list, and so does ending a connected coach's access. Both have to stop
   for "Remove from your list" to be the only thing that removes. This changes
   behaviour for existing accounts, in the safe direction. Confirm.
2. **What the person you invite gets.** Accepting your invite stamps them
   `is_coach` and moves their app to the coach side, even if they are a player
   with their own matches. Options: leave it; or only move accounts that have
   no playing side set up. Recommend the second.
3. **The picker's label.** "Add a coach" there becomes **New coach**, because
   "Add a name" already means naming a waiting invite. Happy with that word?
4. **Two buttons or one.** **End their access** (connected only) and **Remove
   from your list** (always). One button is simpler; two keeps a real
   capability. Recommend two.
