# Starred points — one place for the rallies worth keeping

2026-08-23. Web `/starred` and an iOS screen of the same name, both
reached from **Account → Your game**, directly under Tactics.

Starring already exists everywhere a point does: the match timeline, the
point sheet, the clip player's own chrome, the scorekeeper. What it never
had was a destination. A star put a point into a set you could only see
by going back to the match it came from, one match at a time. This page
is that set, across every match, in one scroll.

---

## What the page is

A library, grouped by match, newest match first. Each group is a header
(the match's poster, its title, the date, how many of its points are
starred) over a grid of tiles, one tile per starred point.

Tapping any tile opens a **sequence player**: the starred points play one
after another, in order, from the one that was tapped. That is the thing
the page is for. A grid of rallies you have to open and close one at a
time is a file browser; a grid that becomes a reel is a highlights tape.

---

## The data

### Why an RPC

Everything the page needs is one row per starred point plus its match —
except the one field that identifies a point to a human: its **display
number**. That is not `points.idx`; it is the position among the match's
*visible* points, in timeline order, which is what the match page prints
and therefore the only number the two surfaces may disagree on.

Computing it client-side means downloading every visible point of every
match that contains a star. For the heaviest account today that is 1,493
rows to render 67 tiles. So the numbering happens in Postgres, where
`row_number()` costs nothing, and the client is handed exactly the rows
it draws.

`starred_points()` is `security definer` and scoped to
`matches.user_id = auth.uid()`. This page is the owner's own shelf; a
coach with match access does not get one.

Ordering inside a match is `t0` then `idx` — the same two keys, in the
same order, as `sortPoints()` in `gameScore.ts`. Change one and change
both, or the number on this page stops matching the number on the match
page.

### What is deliberately NOT returned

**The score at the point** ("8–6, game 2") and **who served** both need a
walk over every point in the match, with the game-boundary overrides
folded in. `gameScore.ts` states plainly that `stepBoundaryWalk` is the
single boundary authority, and that walk already exists twice — once in
TypeScript, once in Swift. Writing it a third time in PL/pgSQL to
decorate a tile would put the authority in three places and guarantee
they drift. Either fetch every point (expensive, see above) or leave the
score off. It is left off.

### Index

`points_starred_idx on points (match_id) where starred and not deleted`.
Partial, because the starred set is a rounding error against the table.

---

## Anatomy

Identical on both platforms, because the two are the same product.

```
Starred points
67 points · 21 matches                            [ Play all ▸ ]

┌ poster ┐  Julian · Westchester                        4 points  ›
└────────┘  Aug 21, 2026 · Match

  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
  │ Point 12    ★ │ │ Point 30    ★ │ │ Point 41    ★ │
  │       ▶       │ │       ▶       │ │       ▶       │
  │ I won   14.2s │ │ They won 6.1s │ │ I won    9.4s │
  └───────────────┘ └───────────────┘ └───────────────┘
```

### The tile

16:9, so a clip drops straight into it with no reflow. The picture is a
real frame **out of the point's own clip** — the only per-point image the
system has. There is no stored still, and a match's poster is the same
picture for every point in it, which is a repeated asset rather than
imagery.

The two platforms get there differently, because one `<video>` per tile is
cheap in a browser and sixty AVPlayers in a scroll view are not:

- **Web** mounts the clip itself at `#t=<seconds>` with
  `preload="metadata"`, paused on that frame. Hovering presses play on the
  element already there, so the preview costs no extra load.
- **iOS** reads one frame with `AVAssetImageGenerator` — a couple of range
  requests, no player, no layer — and the tile holds a `UIImage`.

**Ask for a keyframe, not a moment.** The clips are x264 at its default
keyint of 250, which on a seven-second rally means exactly one sync
sample: frame zero. Requesting 1.5s asks the decoder to run forty-five
frames forward over an HTTP range that may not have arrived, and a partial
decode does not fail — it returns a sheet of green. One tile in three came
back like that on iOS before the tolerance went to infinity.

Under the frame is a designed state that carries the tile until it arrives
and stays if it never does: a wash keyed to the outcome (cyan won, magenta
lost, amber skipped) and the point's own number set enormous and nearly
transparent. The four facts live in the corners — outcome and star on top,
"Point 34" and the duration underneath — over gradient scrims, so they
stay readable whatever the frame behind them looks like.

The match poster appears **once per group**, in the header.

### Hover preview (web, pointer devices only)

Rest on a tile and the rally plays inside it, muted. Gated behind
`(hover: hover) and (pointer: fine)` so a touch device never starts a clip
the person is already leaving.

### The sequence player

Full-screen, portalled to `document.body` on web (`position: fixed`
resolves against `AppShell`'s `.page-enter` transform, and the safe habit
is to not be inside it at all). Reuses `ClipPlayer` on web and
`ClipPlayerView` on iOS — the same players the match page uses, so the
gestures, the zoom, the speed control and the persistence all come along
for free.

- advances on `ended`, which is what makes it a tape rather than a viewer
- prev/next, and the outer thirds of the picture step points
- the **next** clip's URL is minted while the current one plays, so the
  advance is instant instead of a spinner every six seconds
- unstar from inside it: the point leaves the set and the player moves on
- "Open in match" jumps to the point in its own match page

### Copy

- Title: **Starred points**. No subtitle.
- Count line: `67 points · 21 matches`. A fact, not a description.
- Empty: **No starred points yet. Tap the star on any point to keep it
  here.** — the one line, and it carries the only thing a person landing
  on an empty shelf needs to know.
- Unstar confirmation: none. It is one tap to put back, and the tile
  leaves with an undo pill.

---

## Reuse

| Thing | Comes from |
| --- | --- |
| Clip playback, zoom, speed, gestures | `ClipPlayer.tsx` / `ClipPlayerView` |
| Clip URLs | `POST /api/media-url { matchId, pointId }` |
| Match posters | `GET /api/thumb/<matchId>` — stable URL, HTTP-cached, already offline on iOS |
| Match titles | `deriveMatchTitleParts()` / the Swift port |
| Outcome reasons | `howLabel()` / `Scorecard.swift howLabel` |
| Star writes | the same `points.starred` update the match page does |

Nothing new is invented that already exists. The only new server object
is the RPC, and it exists to avoid shipping 1,493 rows.

---

## What lazy actually means here

The list is cheap and the media is expensive, so they are loaded on
opposite schedules.

- **The index** is one round trip and every tile renders from it. There
  is no pagination: 67 rows is not a page-size problem, and paginating a
  grouped list to save 30KB would cost a scroll listener and a spinner.
- **Posters** are one request per *match*, `loading="lazy"`, against a URL
  that never changes so the browser and the iOS disk cache both hit.
- **Clips** are reached for only when a tile is within 600px of the
  viewport (web) or its row appears in a lazy stack (iOS), and the element
  is dropped again when it leaves. Presigned links are minted once and
  shared by the tile and the player, so opening a tile you already
  scrolled past costs nothing, and the player reads one clip ahead.
- **A metered connection gets the designed state instead.** `saveData` or
  a 2g class means no frames at all — the tile still has a picture, it is
  just the number rather than the rally.

