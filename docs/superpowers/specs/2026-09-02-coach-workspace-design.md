# Coach workspace — design (2026-09-02)

One account, two workspaces. A coach switches between playing and coaching
from Account, the way Upwork separates client and freelancer. The coaching
workspace is roster-first: every screen hangs off a student.

Decided with Adil on 2026-09-02:

- Profile switcher, not a bolted-on tab. Full separation on iOS AND web.
- Coaches can sign up cold (no students) or arrive via a student's invite,
  and can set up coaching from the app.
- Coach journal ships on both surfaces; entries are live documents the
  coach keeps editing after sharing; one student per entry.
- Audio entries now; video lessons are v2 ("coming soon" in the UI).
- Paid review orders stay entirely on the web. Nothing order-related
  enters the iOS app.
- Offline students (not on PongLens) are first-class roster members; share
  links carry a join call-to-action and act as a signup funnel.
- In-app bell notifications both directions, no emails.

## What already exists and is reused

- `coach_links` + `has_match_access()`: an accepted link already gives a
  coach the student's matches (all, or one), on web and iOS. The iOS
  library store already receives them.
- `notes` + `notes_notify()`: coaches can already write notes on shared
  matches; everyone with access gets a bell row.
- `lessons` is the journal store (kind 'lesson' | 'practice'); the audio
  pipeline (record → /api/transcribe → /api/lesson distillation) exists on
  both surfaces.
- share_links kind 'entry' (154/155, live in prod): a lessons row can be a
  public, revocable, live-resolving link. Built by the concurrent
  "app fixes too" session; its web UI is uncommitted in this checkout, so
  none of those files are touched tonight (ShareEntrySheet.tsx,
  s/[token]/ShareEntry.tsx, api/share/route.ts).
- `notifications`: trigger-written, denormalised, burst-collapsing.
- `accept_coach_invite` / `coach_invite_info`: the invite grammar
  (standing capability, idempotent accept, viewer-relative info) that the
  reverse direction copies.

## Schema (migration 156)

**`coach_students`** — the roster. `coach_id`, nullable `player_id`
(null = offline student), `display_name` (denormalised; coach may rename),
`archived_at`. Unique (coach_id, player_id) among live linked rows. RLS:
coach full CRUD on own rows. Accepted coach_links backfill a roster row;
a trigger keeps future acceptances in sync.

**`coach_entries`** — a journal entry about one student. `coach_id`,
`student_id → coach_students`, `lesson_id → lessons` (unique — the entry
IS a lessons row, which is what makes link-sharing free), `shared_at`
(null = private draft; set = the linked student can read it),
`created_at`/`updated_at`. RLS: coach full CRUD; the student reads through
an RPC, not the table.

**`lessons.kind` gains 'coach'.** Coach entries live in lessons under
kind 'coach' so the coach's own private journal (a dual-role user) does
not show them. Readers that must exclude the new kind: web journal page,
iOS JournalStore, journal-ask/recollect claim queries. The match link uses
the existing `lessons.match_id`.

**`coach_student_invites`** — reverse invites. `coach_id`, optional
`student_id` (binds an offline roster row on accept), `token`,
`revoked_at`. RPCs mirroring the 031 grammar:

- `student_invite_info(token)` — coach name, is_own_invite,
  already_linked, status. Viewer-relative.
- `accept_student_invite(token)` — idempotent; creates the accepted
  coach_link (player = caller, coach = inviter, scope all), binds or
  creates the roster row, notifies the coach. The join page states
  plainly that the coach will see the student's matches.

**Notification kinds**: `coach_entry` (to the student when an entry is
shared), `student_joined` (to the coach on accept),
`student_match_ready` (to the coach when a linked student's match turns
ready — same recipient fan-out shape as notes_notify). Triggers:
coach_entries share flip; extension of matches_notify.

**`coach_shared_entries()`** — the student's read: entries shared with
them, joined to lesson content (transcript, takeaways, image pinned to
the author's folder as in 155, match_id) plus the coach's display name.

## iOS

**Workspace state**: per-user persisted choice (player | coach).
Coach-mode eligibility = accepted coach_links as coach, or roster rows,
or the onboarding role choice (auth metadata). Coach-only accounts land
in coach mode; dual users get "Switch to coaching" / "Switch to playing"
in Account. RootView renders CoachTabView or MainTabView.

**CoachTabView**: two tabs — Home, Students — plus the New entry action.
Top bar mirrors the player app (account avatar, notification bell).

- **Home**: activity feed (linked students' matches as they turn ready,
  recently edited entries), quick actions: New entry, Invite student.
  Empty state: "No students yet." + Invite student.
- **Students**: roster. Linked rows show the student's matches count;
  offline rows show "Not on PongLens yet". Add student by name.
- **Student page**: header (name, link state, invite), journal entries
  for that student, their shared matches (opens the existing
  MatchDetailScreen/PlayerTakeover — notes and drawing already work).
- **Entry composer**: typed text and/or recorded audio (existing lesson
  pipeline: transcribe, distill into takeaways), optional link to one of
  that student's matches. Video row present but disabled: "Coming soon".
- **Sharing an entry**: "Share with <name>" sets shared_at (bell fires);
  "Copy link" mints/reuses the share_links 'entry' row via PostgREST
  (client-side idempotency: read the active link, else insert; the
  partial unique index settles races). Works without any web deploy.

**Onboarding**: a first step asks how they'll use PongLens — as a player
or as a coach — when the account arrived cold. Coach path: name only,
then coach mode. The invite-born coach path (already built) is unchanged.

**Player-mode Coaching tab** slims to the student side (your coaches,
notes from them, reviews you bought). Its coach-direction content moves
to the workspace; a card points a set-up coach at the switcher.

## Web

- **Workspace switch** on Account; choice in localStorage, same
  eligibility rule. AppNav in coach mode shows Coaching (/coaching) and
  Students (/coaching/students); player mode drops the old conditional
  Coaching tab in favour of the switcher.
- **/coaching** (CoachHub) becomes the workspace home: activity, roster
  shortcuts, and the existing marketplace management (orders, offerings,
  profile — web keeps all of it).
- **/coaching/students**, **/coaching/students/[id]**: roster and the
  per-student page (journal + matches + invite), mirroring iOS.
- **Student receive**: the journal page grows a "From your coach"
  section fed by coach_shared_entries(); entry cards match the journal's
  existing dress. Bell rows link here.
- **/join/[token]**: the invite landing. Signed out → login with a next
  hop back; signed in → "Join Coach X" with the plain-language access
  sentence → accept_student_invite → journal.

## Deliberately out (tonight)

- Join CTA on the shared-entry page itself: that page belongs to the
  other session's uncommitted work; the invite link is the funnel until
  that lands, then the CTA is a small follow-up.
- Video lessons, group entries (multi-student), coach journal emails,
  web onboarding role step (TestFlight is the coach funnel for now),
  push notifications.

## Edge cases carried

- Dual-role coach journaling about themselves: roster rows where
  player_id = coach_id are refused.
- Student deletes account: roster row reverts to offline (player_id set
  null), entries and display name survive.
- Entry shared, then link revoked by the player (coach_links): the
  roster row stays, shared entries stay readable? No — coach_shared_entries
  joins through coach_students.player_id, which survives; access to
  ENTRIES is the coach's grant (shared_at), not the match grant, so
  revoking match access does not silently kill lesson notes. Matches
  disappear from the coach's view immediately.
- Coach revokes/archives a roster row: entries stay (history), sharing
  stops listing the student.
- Same student added twice: linked rows deduped by the unique index;
  offline rows may repeat by name (coach's own housekeeping).
- An offline roster row binding on accept must not steal a row already
  bound to another account.
