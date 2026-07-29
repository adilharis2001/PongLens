# Learn Guides Content Design

## Goal

Make the in-app Learn section useful both to a new player completing a task for the first time and to an experienced player looking up one detail.

## Scope

The work is primarily a content pass. It keeps the existing Learn index, search, guide pages, related-guide cards, and screenshot treatment. A small rendering addition will support numbered steps because a tutorial should distinguish actions from explanations.

## Content model

Each guide follows the same reading order:

1. A short summary that says what the guide helps the reader accomplish.
2. A numbered quick path using the exact labels shown in PongLens.
3. A screenshot of the screen or control used in that path.
4. Short sections that explain choices, results, corrections, or common problems.
5. A “Good to know” callout only when a real limitation or easily missed behavior matters.
6. Related guides for the next likely task.

The quick path must be enough for a returning user. The supporting sections must be enough for a first-time user without repeating every step.

## Voice and writing rules

- Lead with the reader’s goal or next action.
- Use short, complete sentences. Avoid fragments written as slogans.
- Prefer familiar words: “choose,” “open,” “video,” and “point.”
- Use the exact visible control name when giving directions.
- Explain a product term the first time it appears.
- Keep one idea per sentence and one task per numbered step.
- Say what happens after an action, especially when processing or rendering takes time.
- Explain destructive or access-related actions plainly.
- Do not promise behavior that is not present in the code.
- Avoid hype, filler, and claims about what “most” players do unless the product implements or measures it.

## Guide organization

The existing guides remain except for two logical splits:

- Split “Stats and placement maps” into:
  - “Understand match analysis” for one match, including the score-derived cards and camera-derived “Where the ball landed” map.
  - “See your stats across matches” for Account → My stats and the My stats/Tactics views.
- Split “Share your match” into:
  - “Share a public link” for match, point, starred, and tag links.
  - “Invite a coach” for private account-bound access, scope, pending invites, and removal.

The “For coaches” guide remains the receiving-side guide: accepting access, watching, downloading, and leaving point or overall notes.

## Factual grounding

All instructions will be checked against the current implementation:

- File uploads accept MP4 or MOV up to 2 GB and can resume for six days by selecting the same file.
- YouTube accepts supported public or unlisted video URLs up to 45 minutes.
- Upload options use the labels “Break it into points,” “Placement maps,” “Cut strictness,” and “Which player are you?”
- The viewer uses point navigation, playback speed, notes, and a Keep score entry point.
- Keep Score pauses after unscored rallies, advances after a new result, supports Replay, Skip, Delete, Modify, Undo, zoom, game-boundary correction, and an unscored review.
- Point details separate basic scoring from optional Analysis and include Edit clip, In match, Remove, tags, stars, notes, voice notes, and frame drawing.
- Match analysis is based on confirmed scoring and optional follow-ups. “Where the ball landed” is camera-derived and can be incomplete when the recording angle is poor.
- Journal entry creation uses “New,” offers Practice and Lesson, supports typing, pasting, dictation, tags, and optional “Condense and summarize.”
- Export uses one Include score choice and supports the full match, starred points, tag collections, and the raw upload while it is retained.
- Public links are accessible to anyone with the link and can be revoked. Coach invites require sign-in, can cover one match or all current and future matches, and allow notes but not editing.

## Screenshots

Every referenced screenshot currently exists. The pass will treat “missing” as a teaching-placement problem: images will be moved or reused so each split guide has a relevant capture. No new capture is required unless verification reveals that an existing image shows obsolete controls.

The existing Keep Score image shows the current “Modify” control and will be described accordingly. Alt text will name the useful screen or control, not merely the device.

## Implementation boundaries

- Add an optional ordered `steps` field to `GuideSection`.
- Render `steps` as an accessible numbered list.
- Rewrite the Learn landing copy, guide titles, summaries, sections, callouts, relationships, and screenshot alt text.
- Keep search behavior unchanged; it will include step text.
- Do not alter product behavior outside the Learn section.

## Verification

- Add data-level tests for unique slugs, valid related slugs, existing image paths, searchable step text, and expected guide grouping.
- Run the Learn tests, ESLint on touched files, and a production build.
- Review the rendered guide pages at phone and desktop sizes if a local authenticated session is available.

