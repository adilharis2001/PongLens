# Lesson Video Reader, Chapter Index, and Audio

**Date:** September 6, 2026

## Goal

Finish the lesson recap experience so a coach or student can read the complete
lesson, jump directly to any chapter while watching, and hear the lesson audio
on iOS, mobile web, and desktop web.

## Detail page

The ready recap keeps the existing title, status, poster, play action, chapter
count, and recap duration. The first-chapter excerpt is replaced with one
outlined, full-width **Read lesson notes** action above the existing primary
share action.

The action opens a read-only lesson reader. On iOS and mobile web it fills the
screen so twelve or more chapters have enough room. On desktop web it is a
centered, scrollable dialog. The reader shows the lesson title once, followed
by every chapter in order. Each chapter shows its number, title, and every cue.
It does not expose edit controls or timestamps. Coaches and shared students see
the same written content.

The reader is deliberately separate from **Edit recap**. Reading must never
look editable, and editing remains an owner-only action in the More menu.

## Playback chapter index

The cyan **Chapter N of M** label becomes an underlined button in the web and
iOS takeover players. Selecting it opens a chapter index over the player. The
index lists each numbered chapter title and marks the currently playing
chapter. Selecting a row closes the index, selects that chapter, seeks to its
`summary_start_s`, and resumes playback. Previous/next arrows, swiping, timeline
synchronization, and rotated landscape playback continue to use the same
chapter-selection path.

The index is read-only and available to owners and shared students. It does not
show source timestamps because the player already shows recap time.

## Audio

The rendered recap already carries AAC audio. Web playback keeps the existing
speaker control visible in the video’s top-right corner and starts with sound
whenever browser policy allows. If a browser permits only muted autoplay, the
speaker control accurately displays that state and one tap restores sound.

iOS configures `AVAudioSession` for playback when the takeover opens, explicitly
starts unmuted, and adds a 44-point speaker button in the video’s top-right
corner. The button toggles `AVPlayer.isMuted`, updates its icon and accessibility
label, and remains reachable in portrait and landscape. Closing the takeover
pauses the player without changing the stored media.

## Shared student experience

Publishing remains the only transition from owner review to student access. It
continues to create or update the linked coaching journal entry and grants the
linked student access through the existing `coach_entries` and
`coach_students.player_id` checks. The lesson detail API returns the same edit,
playback URL, poster, and summary URL to that authorized student, while keeping
the original source and owner actions private.

The student receives the complete reader, chapter index, synchronized notes,
and audio controls. A student leaving the web detail returns to the journal.
Owners return to the assigned student or lesson-video list as they do today.

## Error and state behavior

- Reader and index actions appear only when a valid edit contains chapters.
- Selecting a chapter without a summary timestamp falls back to the accumulated
  duration of preceding chapters on web and uses the existing guarded native
  selection behavior.
- Signed playback URL renewal preserves the active playback position and mute
  state.
- Media failure keeps the existing retry flow.
- Empty or processing recaps keep their existing status presentation.

## Verification

- Unit tests cover chapter selection and the web reader/index structures.
- Native checks cover the full summary, chapter-index action, playback audio
  session, and mute state.
- Run the complete Next.js production build and the complete iOS test script.
- Build and inspect the iPhone 17 Pro simulator in portrait and landscape.
- Verify production web at 393×660 and 1280×850 with the real Jonathan recap.
- Verify an owner can read but not accidentally publish during QA; use fixture
  coverage for the student sharing authorization rather than sharing Jonathan.
- Upload the verified iOS archive to TestFlight and report Apple processing
  separately from installation availability.
