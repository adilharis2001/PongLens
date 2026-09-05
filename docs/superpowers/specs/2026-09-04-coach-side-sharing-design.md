# Sharing from the coach's side, before the student joins

**2026-09-04.** Against `origin/main` at `e4ab985e`. Nothing here is built
yet; this is the plan to review.

---

## The gap

A coach can add a student who is not on PongLens, open the folder and
write entries into it straight away. None of that is blocked. What is
blocked is letting the student read any of it.

On all three surfaces the Share control is gated on the student having an
account:

| Surface | File | Gate |
| --- | --- | --- |
| Coach's student page | `src/app/coaching/students/[id]/StudentView.tsx:757` | `Boolean(student.player_id) && !entry.shared_at` |
| Coach's Home list | `src/app/coaching/StudentsCard.tsx:204` | `linkedOf(e.student_id) && !e.shared_at` |
| Phone, entry card | `ios/.../Screens/CoachStudentScreen.swift:177` | `shareWith: student.linked ? student.displayName : nil` |
| Phone, entry detail | `ios/.../Screens/CoachEntryScreen.swift:153` | `if student.linked` — the `else` is a dead sentence |

And nothing catches up afterwards. `accept_student_invite` binds the
roster row to the new account and never touches `coach_entries.shared_at`;
`coach_shared_entries()` returns only rows where `shared_at is not null`.
So the day the student joins they find an empty "From your coach", and the
coach has to walk back through every entry by hand.

Live evidence on Adil's account: **Emily** — not on PongLens, 2 entries,
0 shared. **Larry Chen** — joined, 4 entries, 3 shared.

---

## Why this is small

The player side needed migration 166 and a queue table because when you
invite a coach there is no coach yet, so a match grant has nowhere to
live. The coach side has no such problem: **the `coach_students` row is
created the moment the student is added**, so the flag already has a row
to sit on.

**No migration. No RPC change. No server change of any kind.** Three facts
carry that claim:

1. **The write is already allowed.** The only policy on `coach_entries`
   is `Coaches manage own entries`, whose check is `coach_id = auth.uid()`
   AND the student row is this coach's AND the lesson is this coach's.
   Nothing requires the student to have joined. The existing client-side
   `update({shared_at})` proves the column grant exists too.

2. **A marked-but-unjoined entry cannot leak.** Both readers key on
   `cs.player_id = auth.uid()` — `coach_shared_entries()` and
   `entry_image_for_viewer()` (the photo path). With `player_id` null the
   row matches nobody. There is no third reader.

3. **It appears on its own the moment they join.** `accept_student_invite`
   sets `player_id` on that same roster row, at which point both readers
   match. No backfill, no migration over existing rows.

The backstop also already holds: `merge_students` moves `coach_entries`
by changing `student_id` only, so `shared_at` survives a merge.

---

## What we are not building

- **A head-start picker like the player's.** On the player side the
  library is large and lives on another screen, so a multi-select earns
  its place. A student folder holds two to five entries and they are
  listed on the same page you are looking at. A second picker over the
  same five items is the redundant thing.
- **A queue table.** See above — there is a row already.
- **Coach → student match or video sharing.** It does not exist anywhere
  in the product, nothing has asked for it, and a coach entry is words
  plus at most one photo. The MATCHES block on a student's page is the
  incoming direction: their matches, shared with the coach.
- **Sharing on by default.** Tempting, since a coach writing in a
  student's folder probably means them to read it. But private
  observations are real and a wrong default here leaks something a coach
  never meant to send. Keep the choice; make it reachable.

---

## Change 1 — share into a folder the student has not joined

The entry gets marked now and lands when they join. Three states instead
of two, and the third must be honest: **not** "Shared", because nobody has
received anything.

| Entry state | Corner slot |
| --- | --- |
| shared, student joined | `Shared` — cyan badge (unchanged) |
| shared, student not joined | `Waiting` — grey badge |
| not shared | `Share` — the cyan-ringed pill |

"Waiting" matches the vocabulary already on the player side, where a
pending invite sits under "Waiting to accept".

### Web — `src/app/coaching/students/[id]/StudentView.tsx`

- **:757** `const canShare = Boolean(student.player_id) && !entry.shared_at`
  → `const canShare = !entry.shared_at`.
- **:786–805** the corner slot becomes three-way rather than two: when
  `entry.shared_at` is set, pick the cyan `Shared` badge or the grey
  `Waiting` badge on `student.player_id`. The `Share` button is unchanged.
- **:854** `{student.player_id && entry.shared_at && …}` → drop the
  `student.player_id &&`, so a Waiting mark can be taken back. The button
  keeps saying "Stop sharing".
- **:891** the expanded footnote reads "Shared with X. Edits show on
  their side." Add the unjoined wording: "Waiting for X to join. They get
  it the day they do."

### Web — `src/app/coaching/StudentsCard.tsx`

- **:204** drop `linkedOf(e.student_id) &&` from the condition.
- Same three-way slot as above. This card still carries the **old
  full-width cyan "Share with X" button**, which the student page and the
  phone both lost this morning — two screens one tap apart now disagree.
  Fold the restyle in here rather than leaving it.

### iOS — `Components/CoachCards.swift`

- `CoachEntryCard.shareWith: String?` currently means two things at once:
  the name to print, and whether the student has joined. Split them. Add
  `let studentLinked: Bool` **with no default value**, so the compiler
  forces both call sites to say which they mean. A default of `true` here
  would silently keep the old behaviour on whichever site was missed.
- **:47–75** the badge chain becomes: `sharedAt != nil && studentLinked`
  → `Shared` (cyan); `sharedAt != nil && !studentLinked` → `Waiting`
  (`PL.text500`); else the Share pill; else the `queued` case as now.
- Call sites: `CoachStudentScreen.swift:174` and
  `CoachHomeScreen.swift:73`.

### iOS — `Screens/CoachEntryScreen.swift`

- **:153** `if student.linked { … } else { <dead sentence> }`. The else
  branch keeps its sentence but gains the same Share button, worded for
  the waiting case, and the Stop sharing row at **:224** loses its
  `student.linked` gate.

---

## Change 2 — the invite says what is waiting

The head-start equivalent, as a summary of state rather than a second
picker. It belongs in the "Connect {name}" panel, which already sits
*above* the entry list on both platforms — so the coach reads the
consequence, then scrolls into the list and can change any one of them.

Copy, from `entries` which the page already holds:

- no entries → say nothing;
- all marked → "{Name} gets all {n} entries when they join.";
- some marked → "{Name} gets {m} of {n} entries when they join." plus a
  **Share the rest** button;
- none marked → a single **Share all {n} when they join** button.

The bulk action is one statement over the unshared ids:
`update({ shared_at: now }).in("id", ids)` — same shape as the journal's
`moveEntries`, so a half-applied batch is impossible.

- **Web**: inside the `{!student.player_id && (…)}` panel at
  `StudentView.tsx:644`, after the "An invite links them…" paragraph.
- **iOS**: inside `if !student.linked` at `CoachStudentScreen.swift:141`,
  under the same paragraph, with the button as a `PLSecondaryButtonStyle`
  row rather than a primary — "New entry" is already the primary on that
  screen.

---

## Change 3 — the general invite asks who it is for (iOS only)

`StudentInviteSheet(student: nil)` is offered from `CoachHomeScreen.swift:100`
and `CoachStudentsScreen.swift:79`. Accepting one of those links takes the
`v_invite.student_id is not null` branch in `accept_student_invite` — which
it fails — so a **brand new roster row** is created and the folder the
coach has been writing into stays behind, unbound, with its entries and
their Waiting marks on it.

Today's only repair is "Same as an existing student" on the new student's
page, which a coach finds only if they know to look for it.

Prevent rather than repair. In `Screens/StudentInviteSheet.swift`:

- add `@State private var picked: CoachStudentRow?`;
- when `student == nil` **and** the roster holds any `!linked` student,
  show a section above the QR: "Who is this for?", a row per unjoined
  student, plus **Someone new** selected by default;
- resolve the target once — `let target = student ?? picked` — and use it
  in the `.task`, the title, the footer and the reset dialog. Key the
  `.task` on `target?.id` so choosing a name refetches the right link.

The web has no general invite at all (only the per-student link from
`StudentView.tsx:421`), so this is iOS-only.

`CoachTabView.swift:172` also constructs the sheet with
`workspace.activeStudents.first`, which looks wrong but is behind
`devInviteOpen` — a dev-args-only sheet. Leave it.

---

## What could break, and how we check

| Risk | Guard |
| --- | --- |
| A missed `CoachEntryCard` call site silently loses the Share pill | `studentLinked` takes **no default**, so it will not compile until both sites are updated |
| "Stop sharing" appears where nothing was shared | Its condition stays anchored on `entry.shared_at`, only the `player_id` half goes |
| A marked entry reaching somebody early | Impossible by the readers' own `cs.player_id = auth.uid()`; verify by marking one of Emily's entries and confirming `coach_shared_entries()` returns nothing for any account |
| The bulk share half-applying | One statement with `.in("id", ids)` |
| A pre-marked entry lost in a merge | `merge_students` changes `student_id` only; `shared_at` rides across. Verify on a throwaway pair |
| The web Home restyle changing behaviour | The condition and the `share()` call are untouched; only the markup around them moves |

### Test plan

Fixture is **Emily** (2 entries, not on PongLens) plus a throwaway account.

1. Mark one of Emily's entries. Badge reads `Waiting`, grey. Confirm in
   SQL that `shared_at` is set.
2. As the throwaway account, confirm the journal shows nothing.
3. "Share all when they join" from the Connect panel — both entries
   marked in one statement.
4. Take one back with Stop sharing.
5. Accept Emily's **per-student** link on the throwaway account. Land on
   `/journal?from=coach`; the marked entry is there, the unmarked one is
   not. The coach's badge flips `Waiting` → `Shared`.
6. Repeat with the **general** link and confirm the picker binds Emily's
   row rather than making a new one.
7. Same six on the phone.
8. Restore: unshare, and archive/merge anything the test created.

---

## Open questions

1. **"Waiting"** — happy with the word? Alternatives were "On join" and
   "Queued"; "Waiting" reads plainest and matches the player side.
2. **Does a student who joins to find three entries waiting get told?**
   Today they land in their journal and no notification is sent. Adding
   one is a small extra: `accept_student_invite` already writes a
   `notifications` row for the coach and could write one for the student.
   Not in scope unless you want it.
3. **Change 3 now or later?** The merge backstop works and preserves the
   marks, so it is a papercut rather than data loss. It is also the
   cheapest of the three.
