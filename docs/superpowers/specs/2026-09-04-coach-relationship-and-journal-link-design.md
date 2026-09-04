# Coaches, journals and match access — design

2026-09-04. Written from Adil's three asks in one sitting: the invite-accept
bug, linking journal entries to a real coach, and controlling which matches a
coach can see.

The first is fixed and committed. The other two are specified here.

---

## 1. The bug, and why it happened (fixed, commit `713a8180`)

**Symptom.** A coach opens a player's invite link, accepts, and the app puts
them on the *playing* side — Home, Upload, Matches, Journal — even when they
have never uploaded a match in their life.

**Cause.** Both accept paths finished with `router.replace("/dashboard")` (or
its server twin in `completeSignIn`). `/dashboard` is player territory in
`routeTerritory`, and the nav's `rememberLanding` writes the workspace cookie
from whatever page actually rendered. So the last step of accepting a *coach*
invite was an instruction to the app that this account is a player. It then
stayed that way, because the cookie is the remembered side.

**Fix.** Both paths now land on `/coaching` and stamp the workspace cookie to
`coach`. The stamp is not optional and not belt-and-braces:

- `accept_coach_invite` sets `is_coach` on the account, but this session's
  token was minted before that, so the flag alone does not survive the first
  paint.
- `/coaching` is *shared ground*: it renders whichever side the workspace
  names. Without the stamp, a fresh coach would land on the player's view of
  the coaching page, which says "Add a coach" to a coach. That exact failure
  is what 157 fixed once already.

A match-scoped invite still opens its match, because that is the thing the
player sent; the cookie makes the bar around it the coach's. "Already
accepted" now points at `/coaching/students`, which is unambiguous coach
territory, so standing on it also repairs anyone the old destination flipped.

**Deliberate call.** The stamp is unconditional, including for someone who
also plays. Migration 158 was careful not to flip active players overnight,
but that was a silent backfill; this is a person pressing accept on a coach
invite. The playing side is one tap away and the switch appears in the bar the
moment the account has both. Verified: a player whose cookie read `player`
accepted an invite and finished on the coaching side with a **Playing** switch
in the top left.

**Verified against a production build**, not a typecheck: a signed-out coach
through sign-in and onboarding, and a signed-in player. Both finished on
`/coaching` with the Home/Students/Orders bar and the student on the roster.
iOS only *shares* invite links; accepting is web-only, so there is no app-side
change.

---

## 2. Linking journal entries to a real coach

### What is wrong today

`lessons.coach_name` is free text (085). It was the right call at the time —
"a coach here is often not a PongLens user, and the journal should not require
them to be one" — and it is still right that a coach need not have an account.
What is missing is the case where they *do*.

Adil's own journal is the evidence, and it is the exact failure 085 predicted
for transcripts and then re-created in the input box:

| entry | `coach_name` |
| --- | --- |
| 19 Aug | `Jonathan` |
| 30 Aug | `Jonotan` |

Two lessons with one person, two spellings, so they are two coaches as far as
anything that reads the journal is concerned. Ask groups by that string
(`corpus.ts` builds "with {coach_name}"), the editor's suggestion list is
built from it, and the coach who is *actually on PongLens* — Jonatan Mcdonald,
`jjmytanlau@gmail.com`, on the app since 1 September — is connected to none of
it. The relationship and the journal are two separate worlds.

### The shape of the answer

A player-side mirror of `coach_students`. The coach workspace already solved
this exact problem from the other direction: a coach lists students, some on
PongLens and some not, with a `display_name` they typed and a `player_id` that
fills in later. The player needs the same list of coaches.

```
player_coaches
  id            uuid pk
  player_id     uuid  -> auth.users     the journal's owner
  coach_id      uuid  -> auth.users     null until they accept
  display_name  text                    "Jonathan", as the player types it
  invite_id     uuid  -> coach_links    the pending invite, when there is one
  created_at, archived_at
```

`lessons` gains a nullable `coach_ref_id -> player_coaches`.

Three properties matter, and each answers something Adil asked for:

- **`coach_id` is nullable, so invited and accepted both work.** This is the
  crux of the ask. A pending `coach_links` row has `coach_id = null` — nobody
  has claimed it — so a lesson cannot point at a user id yet. It can point at
  a `player_coaches` row from the moment the player creates one, and that row
  binds to the account on accept. It also covers the coach who will never join
  PongLens, which is most of them.
- **`coach_name` stays.** It is not migrated away and not dropped. Ask, the
  iOS journal, the entry share page and `/s/[token]`'s "Lesson with Jonathan"
  all keep working untouched, and the text remains the answer for a coach with
  no row. `coach_ref_id` wins when present; the text is the fallback.
- **One row per coach, not per link.** `coach_links` multiplies — a coach with
  four shared matches has four rows. Journals must not.

### The sharing decision (Adil, 2026-09-04)

**Does moving an entry to a coach let that coach read it? Yes, but the app
asks every time.** Adil's call, made against a recommendation of "attribution
only" and against a "share everything automatically" alternative. Neither
extreme was right for him: silence is how a private reflection reaches a coach
without anyone deciding it should, and a separate later step is how a coach
ends up with none of the entries that were meant for them.

So attaching and sharing are one moment, with the answer stated rather than
assumed. Three rules keep that from becoming a treadmill:

1. **The ask is inline, in the same control, never a second modal.** Picking
   the coach and answering "share it with them?" happen in one step. A
   blocking dialog after every save would make the journal tiring to write in,
   which is the fastest way to stop a player journalling at all.
2. **It defaults to not shared.** The default has to be the safe one, because
   a default is what gets accepted when someone is not reading.
3. **A bulk move asks ONCE for the batch.** Moving forty entries onto Jonathan
   is one decision about forty entries, not forty decisions. This is also the
   path Adil will use first, on his own back catalogue.

The grant itself mirrors `coach_entries.shared_at`, which is how a coach
already shares an entry with a student: a timestamp on the link row, read
through a SECURITY DEFINER RPC. `lessons` RLS stays author-only in both
directions, and unsharing is one write.

### What gets built

**Migration**

1. `player_coaches` + RLS (player owns their rows, full control).
2. `lessons.coach_ref_id`, nullable, with a column grant.
3. `player_coaches_sync()` on `coach_links`: an accepted link binds the
   matching row's `coach_id`, the same way `coach_links_roster_sync` maintains
   the coach's roster today. One trigger, both directions.
4. `lessons.shared_with_coach_at` — the sharing answer sits on the ENTRY, not
   on the coach row, because it is a decision about one entry. Null means
   attributed but private. Plus
   `set_lesson_coach(p_lesson_id, p_coach_ref_id, p_share boolean)` — sets the
   link, records the sharing answer, and copies the display name into
   `coach_name` so every existing reader stays right.
5. `coach_shared_lessons()` — the coach's read, the mirror of
   `coach_shared_entries()`. `lessons` RLS stays author-only; the coach never
   selects from the table.

**Backfill for Adil's account** (his explicit ask). All current data is
non-production, so this is safe to do by hand:

- create `player_coaches` for Adil, `display_name = 'Jonathan'`, `invite_id =
  d02a8546-…` (his pending invite `1127e4aa-…`);
- point both lessons at it, including the `Jonotan` one, and normalise both
  `coach_name` values to `Jonathan`;
- when Jonatan Mcdonald accepts `1127e4aa-…`, the trigger binds
  `coach_id = ed14d9b5-…` and the journal, the invite and the account are one
  thing.

Note his invite is scoped **selected** (`all_matches = false`), so accepting
connects him without handing over any matches. That is the correct scope for
this and needs no change.

**Web**

- `JournalEditor` and `NoteEditor`: the "Who taught it?" input becomes a
  picker over `player_coaches` with free typing still allowed. Typing a new
  name creates a row. This is where the two spellings stop happening.
- `LessonCard`: attribution reads from the row, so a rename fixes every entry
  at once.
- Journal: filter by coach, and a bulk **Move to a coach** on selected
  entries. This is the "move my journals to that coach" half of the ask, and
  it is what repairs a journal that already has three spellings in it.
- `SharingSection`: a connected coach shows how many entries are attributed to
  them and how many they can read, so the two halves are visibly one
  relationship and "what does Jonathan have" is answerable without hunting.
- The coach's student page gains the entries their student shared, beside the
  entries the coach wrote. One place, both directions.

**iOS**

Same picker in the journal composer, same attribution on the card
(`JournalStore.swift`, the entry composer). The rule lives in two places
again, so it needs the same care as `Placement.swift` and
`placementAggregate.ts`.

**Ask**

`corpus.ts` groups by `coach_ref_id` when present, falling back to the text.
"What did Jonathan tell me?" then answers over both entries instead of one.

---

## 3. Match access: all matches, or the ones I choose

**This is already built.** Migration 161 shipped it on 2 September, on web and
iOS, and Adil's own pending invite was created with it.

Where it lives today:

- **At invite time.** Coaching → Coaches → **Add a coach** offers three
  scopes: this match, all my matches, or *only matches I share* (connect now,
  share later).
- **Any time after.** Coaching → Coaches → tap a coach's row. Two pills, **All
  matches** and **Only matches I share**, switchable either way without
  removing them, plus a per-match list where each share can be revoked on its
  own. `set_coach_access` is the single RPC behind both platforms.
- **Per match.** A match page's Share with coach sheet shares that one match
  with a coach who is already connected.
- **Enforced in one place.** `has_match_access()` and the `matches` select
  policy read the same rule, so a coach cannot reach a match through points,
  notes or clips that the rule denies.

### What is genuinely missing

1. **A pending invite's scope is frozen.** `set_coach_access` requires an
   accepted link ("coach not connected"), and `SharingSection` only builds
   rows for accepted coaches. So an invite sent as "all matches" that should
   have been "only matches I share" has to be revoked and re-sent. Fix: allow
   the pills on a pending invite too, writing `all_matches` on the row
   directly. Small, and it removes the one irreversible-feeling step in the
   flow.
2. **Sharing several matches means visiting several match pages.** There is no
   "share these five". Fix: a multi-select on the coach's row in Coaching, or
   a coach picker in the Matches library. Worth doing after the pending-scope
   fix, not before.
3. **Discoverability.** The control is two taps deep behind a coach's row with
   nothing on the row saying it can be changed. The row already reads "All
   matches" or "3 matches"; making that summary itself the affordance would
   cost nothing.

---

## Order of work

1. ~~The invite-accept bug.~~ Done.
2. Pending-invite scope (item 3.1). One afternoon, removes a dead end.
3. `player_coaches` + `coach_ref_id` + the trigger + Adil's backfill. The
   foundation; nothing else in section 2 can be built without it.
4. The web picker, attribution and bulk move.
5. iOS parity.
6. Ask grouping.
7. The sharing grant and the coach's read of it. Built with step 4 rather
   than after it, because the ask lives inside the move.

---

## As built (2026-09-04)

Migration **164**, plus the web and iOS surfaces. Where the build differs
from the plan above, the reason is here rather than in a commit nobody
will find.

**Ask needed no change at all.** The plan said `corpus.ts` would group by
`coach_ref_id`. It does not have to: `lessons_coach_normalise` copies the
coach row's name onto `coach_name` on every write, so the text column that
Ask already groups by becomes correct the moment an entry is moved.
"Jonathan" and "Jonotan" both read "Jonathan" once they point at one row.
Nothing changed in Ask, iOS's readers, `/s/[token]` or the share page,
which is the whole reason `coach_name` was kept rather than migrated away.

**No write RPC.** The plan had `set_lesson_coach`. The trigger turned out
to be the better home for every rule it would have carried — a lesson may
only point at its own author's coach, the name is copied, no coach means
no grant — and once the rules live there, a plain table write is safe from
web, iOS and anything future. One implementation instead of two.

**`merge_player_coaches` was added, and it is not optional.** A name typed
before an account arrives will not match the name on it: Adil's own case
is a row he would call "Jonathan" and an account called "Jonatan
Mcdonald". Without a merge the two would sit side by side forever. It
refuses to fold two connected accounts together, because those are two
different people and folding them hands one coach the other's entries.
Surfaced as "Same as an existing coach" on a coach's row, the same words
the coach side already uses for the mirror problem.

**Naming a coach while creating their invite** is what makes "invited"
usable rather than theoretical. `player_coaches.invite_id` points at the
pending link, so binding on accept is exact rather than a guess at a name,
and the waiting invite in Coaches says who it is for instead of "Invite
link".

**`student_shared_lessons()` needs two things, not one:** the entry shared
AND the coach link still accepted. Sharing alone would let a coach who was
removed keep receiving journal entries, which is 157's bug arriving in a
new place. `leave_coach` stops the sharing for the same reason it unbinds
the roster, and keeps the attribution: you stopped working with them, you
did not stop having had the lessons.

**"Move entries" shows even with no coaches yet.** That is precisely the
journal that needs it, and naming a coach lives inside the move sheet.
Gating the button on an existing coach left the only door through the
composer for a NEW entry.

**Pending-invite scope** (item 3.1) shipped with it: the two pills now
appear on a waiting invite and write `all_matches` straight onto the row,
because `set_coach_access` needs an accepted link to hang a connection
off. That was the one step of the flow with no way back.

**Not done, deliberately:** Adil's own backfill. He asked to send Jonathan
a real link and watch the feature work rather than have the relationship
wired up by hand, so migration 164 creates rows only for coaches a player
is ALREADY connected to, and touches no lesson. His two entries stay as
they are until he moves them himself.
