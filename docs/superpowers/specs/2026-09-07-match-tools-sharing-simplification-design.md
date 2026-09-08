# Match tools and sharing simplification

**Date:** 2026-09-07
**Status:** Implemented for build 160

## Purpose

PongLens will make the match Tools area easier to understand without changing
its approved visual language. Each top-level row will name one distinct job:

- review the automatically selected highlights;
- understand the scored match;
- inspect serve placement;
- create a public link;
- give a coach private access; or
- create or download a video file.

The same work will make a public highlight link carry the scored-match context
that the normal match link already has. A viewer of highlights from a scored
match will see the running score over the video, the final result, match
analysis, and placement maps when the owner includes score and stats.

## Product outcome

After this change, a player should be able to answer these questions without
opening several sheets:

- **Highlights:** What were the best rallies, and how can I play or distribute
  that highlight video?
- **Match analysis:** What does my scored match say about how I played?
- **Serve placement:** Where did the serves land?
- **Share a link:** What can another person watch in a browser?
- **Coach:** Which coach can privately access this match and leave notes?
- **Export:** Which video file do I want to create or download?

The number of capabilities does not shrink. Their ownership becomes explicit.

## Scope

This specification covers four surfaces:

1. The native iOS match page and its sheets.
2. The authenticated web match page at mobile and desktop widths.
3. The public `/s/[token]` highlight page.
4. Account link management, which continues to revoke every public link kind.

The iOS app is the primary product surface for this change. Web adopts the
same information architecture and public-link behavior while retaining
platform-appropriate controls.

## Non-goals

- Do not redesign the Tools card, colors, typography, corners, spacing, or
  button system.
- Do not change automatic-highlight qualification, selection, duration,
  regeneration, or rendering.
- Do not automatically generate or regenerate highlights when a match or link
  is opened.
- Do not change coach permissions, invite acceptance, or journal access.
- Do not remove point links, tagged-point links, or existing link revocation.
- Do not make names, score, or logo switches change the automatic highlight
  stored by the worker.
- Do not burn a score into the public highlight video.
- Do not add a new worker job or consume processing minutes for public links.

## Information architecture

### Tools row order

The Tools card keeps its existing divided-row presentation. Rows appear in
this order when they apply to the match:

1. Score the Match
2. Highlights
3. Match analysis
4. Serve placement, or Placement maps while the broader placement mode is in
   use
5. Share a link
6. Coach
7. Export
8. Notes
9. Match details
10. Your side
11. Report an issue

Practice sessions continue to omit scoring-only rows. Unprocessed matches keep
their existing reduced set of available actions.

No internal group headings or additional bordered containers are added to the
Tools card. Ordering and direct labels provide the grouping.

### Row labels and trailing states

| Row | Trailing state |
| --- | --- |
| Score the Match | Current games won when scoring exists |
| Highlights | Existing lifecycle summary, such as `17 rallies · 2:29`, `Generate`, or `Update needed` |
| Match analysis | Existing concise scored-data summary |
| Serve placement | Existing generation lifecycle |
| Share a link | `Not shared`, `1 link`, or `<n> links` |
| Coach | Existing `Invite your coach` or shared state |
| Export | `Video files`, unless an existing active export state is more useful |

The word **Share** is not used as the Tools row label because it does not say
whether the result is a link, file, social post, or coach permission.

## Match analysis

### Page placement

Match analysis becomes a visible content section for the owner. It appears
after Points and immediately before Serve placement or Placement maps.

The order of the lower match page is:

1. Points
2. Match analysis
3. Serve placement or Placement maps
4. Overall notes

The section uses the existing analysis-card implementation. On compact widths
it remains the existing horizontally browsable card deck. On wider web widths
it remains the existing grid. No analysis card is restyled.

### Navigation

Tapping **Match analysis** in Tools scrolls to the inline section:

- iOS uses a stable `match-analysis` scroll identifier.
- Web uses the existing match-analysis ref and scroll offset.
- Reduced-motion preferences must not be overridden.

The owner-only `AnalysisSheet` presentation is removed. There must be one
owner presentation of the analysis, not a sheet and an inline copy.

### Availability

- Match analysis appears only for match types that collect a score.
- It remains visible when the match is only partly scored and uses the existing
  teaching or incomplete-data state.
- Practice sessions do not show the row or section.
- Coach viewers retain their existing read-only analysis presentation.

## Public-link model

### One link system

**Share a link** is the only public-link creation concept. At match level it
offers these targets when available:

1. This match
2. Highlights
3. Starred points

Existing tagged-point collections on web remain available after these primary
targets. Point-level sharing continues to open directly for that point.

The target chooser uses the existing sheet row/card treatment. It must not
compress three long labels into an unreadable segmented control at phone
widths.

Selecting a target opens the existing link composer for that target. The
composer keeps the current behavior for creating, reusing, sharing, copying,
showing a QR code, and revoking from Account.

### Contextual highlight entry

The Highlights sheet retains a **Share a link** action. That action opens the
same public-link composer with **Highlights** already selected. It does not
mint and immediately share a link before the player can see the link settings.

This is deliberate contextual duplication: there is one link system with two
entrances, not two link implementations.

### Highlight availability

- The Highlights target can be selected only when the current automatic reel
  is ready and has a valid stored file and manifest.
- A legacy match with `needs_generation` shows the existing explicit Generate
  highlights request. Opening a link sheet does not start generation.
- A stale match with `needs_update` shows the existing explicit Update
  highlights request. Opening a link sheet does not start regeneration.
- If the highlight reel is empty, unavailable, rendering, or updating, a new
  highlight link cannot be created.
- An already-created highlight link continues to follow the match's current
  ready highlight artifact after regeneration.

### Link settings

For **This match** and **Highlights**, a scored match offers one setting:

`Include score and stats`

Its explanatory copy is:

`The running score over the video, plus the result and the placement maps.`

The setting defaults on. It controls the entire scored portion of the public
page:

- running score over the video;
- final result;
- match analysis; and
- placement maps when available and not flagged.

For an unscored match the setting is absent. Starred, tagged, and single-point
links keep their existing behavior and do not gain a running scoreboard.

Changing the setting updates the existing active link. It does not create a
second URL or render another file.

## Highlights sheet

The approved Highlights sheet keeps these actions:

1. Play highlights
2. Instagram
3. Share a link
4. Save the video

Instagram continues to ask Story or Reel as a follow-up. The top-level sheet
does not regain separate Instagram Story and Instagram Reel cards.

The existing switches remain visible because they make the useful choices
available before rendering:

- Include names
- Include score
- Include logo

A small existing-style label and one line of helper copy clarify their scope:

- Label: `Video appearance`
- Helper: `For Instagram and saved videos.`

These switches affect Instagram and Save the video outputs only. The public
link is a webpage and uses its own **Include score and stats** setting. The
public page retains its standard match heading and PongLens identity rather
than treating webpage branding as burned-in video artwork.

## Highlight public-page score and stats

### Confirmed defect

The highlight link currently resolves and plays the automatic highlight MP4,
but the public page loads point and score data only when
`share_links.kind = 'match'`. A highlight link therefore has:

- an empty point list;
- no score calculation;
- no running score overlay;
- no result or match analysis; and
- no placement maps.

Using the whole match's `cut_t0` values directly would still be incorrect. The
highlight video has its own output clock after segments are joined and
crossfaded.

### Data contract

A public highlight token may resolve:

- the same safe point fields already published by a whole-match link;
- the same trusted placement fields already published by a whole-match link
  when score and stats are enabled; and
- a sanitized highlight timeline containing only:

```ts
type PublicHighlightTimelineRow = {
  point_id: string;
  output_start_s: number;
  output_end_s: number;
};
```

The raw manifest's detector counts and internal evidence do not need to reach
the browser.

Resolution remains token-gated through `SECURITY DEFINER` functions. Anonymous
users receive no direct table access.

### Score calculation

The public page loads the full ordered visible point list for scoring context.
For each selected highlight segment it maps:

`highlight output time -> point_id -> full-match point index`

The overlay shows the score **entering** the selected rally. It never includes
the result of the rally currently being watched.

The existing highlight transition contract remains authoritative: during the
0.3-second crossfade, the incoming rally owns the overlap beginning at its
`output_start_s`. The public page must match iOS and authenticated web rather
than introducing a second transition rule.

If a manifest points to a deleted or unknown point, that segment is omitted
from the score timeline. If no valid segment remains, the page must not invent
a score mapping.

### Static scored content

The result, analysis, and placement maps describe the complete scored match,
not only the selected highlights. This matches the normal match link and gives
the viewer the context the player intended to share.

### Live behavior

Public highlight links remain live:

- regenerating highlights updates the video and sanitized timeline behind the
  same token;
- changing scoring updates the score and analysis behind the same token;
- changing **Include score and stats** updates the same token; and
- revocation invalidates future page and media resolution.

No public request starts generation. A ready artifact is a prerequisite for
creating the link.

## Export

Export remains the home for file-oriented actions:

1. Full match
2. Starred points
3. Raw match

**Instagram Reel** is removed from Export. Automatic Instagram sharing stays
under Highlights. If starred points later need a social destination, that must
be designed from the Starred points context rather than added back as a second
Instagram entrance in Export.

`Include score` applies only to rendered Full match and Starred points files.
Raw match remains the untouched original upload. Highlight saving remains in
Highlights and does not need another Export row.

## Coach

Coach remains a separate top-level action because it grants private,
authenticated access and note-taking capability.

The Coach sheet keeps management before creation:

1. Connected coaches
2. Waiting invitations
3. Invite another coach

The **Invite another coach** form is reordered into one decision sequence:

1. Their name, optional
2. This match or All my matches
3. Give them a head start, optional
4. Match and journal-entry starter selections
5. The existing concise explanation of what accepting grants
6. Create invite link

**Create invite link** is the final primary action at the bottom. The selected
starter content is applied as part of the same creation operation. There is no
second confirmation menu and no permission change.

After creation, the sheet exposes the existing send, copy, and QR actions for
the resulting invite.

The generic web Share a link sheet no longer includes **With your coach**.
Coach access is reached through the dedicated Coach row, matching iOS.

## Copy inventory

These are the canonical user-facing labels introduced or clarified here:

| Context | Copy |
| --- | --- |
| Tools row | `Share a link` |
| Link sheet title | `Share a link` |
| Link target | `This match` |
| Link target | `Highlights` |
| Link target | `Starred points` |
| Link setting | `Include score and stats` |
| Highlights subsection | `Video appearance` |
| Highlights helper | `For Instagram and saved videos.` |
| Export trailing value | `Video files` |
| Coach primary action | `Create invite link` |

Existing error and lifecycle copy remains unless a behavior change in this
spec requires otherwise.

## Accessibility and layout

- Reuse the current PongLens sheet, card, field, toggle, and button styles.
- Do not add nested bordered panels around a message, form, and its actions.
- Primary actions use the current cyan treatment. Secondary actions use the
  existing outline treatment.
- Form and action buttons fill the available width on iOS and mobile web and
  remain at least 44pt or 44px tall.
- Target rows, Tools rows, and icon controls retain at least a 44pt or 44px
  touch target.
- VoiceOver and web accessibility names must state the action and relevant
  status.
- Dynamic Type must not truncate action names or the three link targets.
- Verify mobile web at 393x660, not only a tall phone viewport.
- Verify native iOS independently. A web screenshot does not verify iOS.

## State and edge-case matrix

| State | Highlights row | Highlights link target | Public link behavior |
| --- | --- | --- | --- |
| Ready, scored | Play and distribution actions | Enabled; score and stats default on | Video, running score, result, analysis, maps |
| Ready, unscored | Play and distribution actions | Enabled; no score setting | Video and standard page context |
| Needs generation | Explicit Generate request | Unavailable | Existing token cannot exist for a never-generated reel |
| Needs update | Explicit Update request | Existing ready link may remain; no automatic job | Same token follows the next successful ready artifact |
| Rendering or updating | Progress state | Cannot create a new link | Existing page shows last ready artifact when retained, otherwise a calm unavailable state |
| Empty | `No highlight rallies` | Unavailable | No new link |
| Failed or unavailable | Existing failure state | Unavailable | No new link |
| Revoked | No change to owner reel | New link may be created later | Old token resolves nothing |

## Acceptance criteria

### Information architecture

- Tools retains the current visual treatment and uses the specified row order.
- The row reads **Share a link**, not **Share**.
- Match analysis precedes Serve placement in Tools and in the lower page.
- Instagram Reel is absent from Export.
- Coach creation ends with **Create invite link** after starter selections.

### Match analysis

- On iOS, tapping Match analysis scrolls to an inline owner analysis section.
- The iOS owner analysis sheet no longer opens.
- Web and iOS use the existing analysis card content and status calculations.
- Practice sessions show neither the scoring-only row nor the section.

### Public links

- The same link composer creates match, highlight, and starred-point links.
- The Highlights sheet opens that composer with Highlights selected.
- Link creation does not enqueue any video job.
- Opening any link does not generate or regenerate highlights.
- Existing point, tag, starred, entry, and revocation behavior remains intact.

### Highlight score and stats

- A scored highlight link defaults to showing the score entering each selected
  rally.
- The score changes according to highlight output time, not full-match cut
  time.
- The incoming rally owns the crossfade overlap, matching existing highlight
  playback.
- The page shows the final result, match analysis, and trusted placement maps
  when **Include score and stats** is on.
- Turning the setting off hides all four scored elements without rerendering.
- Regenerating the highlights updates the current public link's video and
  timeline without changing its URL.
- A malformed or stale manifest never causes a point result to be attributed
  to the wrong rally.

### Verification

- Focused TypeScript, route, migration-contract, and Swift tests pass.
- The complete iOS Swift harness passes.
- The PongLens iOS scheme builds for the simulator with code signing disabled.
- The real `npm run build` passes in an isolated worktree with its own `.next`.
- Authenticated web is inspected at 393x660 and desktop width.
- The public scored-highlight page is inspected at 393x660 and desktop width.
- Native iOS is inspected separately for Tools ordering, analysis scrolling,
  Highlights, Share a link, Export, and Coach.

## Release order

1. Apply the public resolver migration.
2. Deploy the web API and public page changes.
3. Verify a scored private test match through a newly created highlight link.
4. Deploy authenticated web information-architecture changes.
5. Ship the iOS build after native verification.

The migration is additive for existing links. The web deployment must support
the new sanitized timeline before the iOS composer exposes the unified flow in
production.
