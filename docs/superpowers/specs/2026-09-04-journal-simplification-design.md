# The journal goes back to four tabs

**2026-09-04.** Approved by Adil the same day. Against `origin/main` at
`e31d0f32`.

---

## The tabs

Six become four, plus Recollect when it is on:

    All · Matches · Notes · From Coaches [· Recollect]

`Lessons` and `Practice` merge into **Notes**. `From your coach` becomes
**From Coaches**. The coach pills and **Move entries** go entirely.

## Why the split was never real

The composer made the player choose Practice or Lesson before writing a
word, and that choice controlled exactly one thing: whether the entry
could carry a coach and be shared with them. It was never two kinds of
note. It was one kind of note with an optional "who this was with", and
the tab bar was showing an internal split rather than a question anybody
asks.

The usage says the same. Seven entries across the whole product name a
coach, and five are shared — all by one account. Six players have exactly
one coach; the only player with more is the test account. A rail of coach
pills and a bulk **Move entries** mode exist for a situation that has
never happened.

## The rule that replaces it

`lessons.kind` stops being chosen and becomes **derived**: `'lesson'` when
a coach is attached, `'practice'` when not. `'coach'` (written by a coach)
is untouched.

**Nothing reads it for display any more.** Every label derives from
`coach_name` instead — "Lesson with Miguel Santos" when there is one,
"Note" when there is not. That makes a stale `kind` harmless, which
matters because the edit routes do not rewrite it: a note that gains a
coach later keeps `kind='practice'` and still reads correctly everywhere.

**No migration.** The column keeps every value it has. The journal simply
stops filtering on it.

## What is kept

The per-entry coach field and its share toggle. Adil's own reason: a
player may write a note after a lesson and not want to send it. That
nuance is one optional field and it stays — it moves from a mode chosen
up front to a line inside the composer, offered on every note.

Low usage is not evidence against it; the feature is days old. The pills
are different: they solve a many-coach problem that does not exist.

## Web

| File | Change |
| --- | --- |
| `NotesFeed.tsx` | `Section` becomes `all\|matches\|notes\|coach\|recollect`. Tab row rebuilt. `section === "notes"` takes every own entry with no kind filter. Delete the pills block, **Move entries**, `coachFilter`, `selecting`, `selected`, `movingOpen`, `moveEntries`, the `MoveToCoach` import and render, and the selection wrapper in the row renderer. |
| `JournalEditor.tsx` | Kind chips and `kind` state deleted. `CoachPicker` always rendered. One subtitle. Saves `kind: coachRefId ? "lesson" : "practice"`. |
| `NoteEditor.tsx` | The `CoachPicker` gate widens from `kind === "lesson"` to `kind !== "coach"`, so any own note can gain a coach. Placeholder stops branching on kind. |
| `LessonCard.tsx` | Header and `shareTitle` derive from `coach_name`, not `kind`. |
| `MoveToCoach.tsx` | Unused; deleted. |

## iOS

| File | Change |
| --- | --- |
| `JournalScreen.swift` | Tab names, `feedItems` filter, `emptyLine`, `revealSource`, the entry card's label line, and `kindLine` on the share title. `NewEntrySheet` loses the Practice/Lesson choice: **Note** and **Audio record a lesson**. `JournalComposer` drops its `kind` state, always shows `CoachPickerRow`, and derives the kind on save. |
| `RecollectSection.swift` | Its kind label derives the same way. |

## Layout, on all three

The tab row is a horizontal scroller on both platforms already. Four tabs
instead of six shortens it, and on a 393px phone the whole set should now
fit without scrolling — which is the point of the change and worth
checking rather than assuming.

## Verification

1. Desktop web at 1440×900 and 1100×900.
2. Mobile web at **393×660**, not 393×844.
3. The phone.

On each: every tab lists the right entries, an entry with a coach reads
"Lesson with X" and one without reads "Note", the composer offers the
coach line on any note, and an entry saved without a coach still opens
and edits.
