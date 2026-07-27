# PongLens Navigation and Information Architecture Proposal

## Executive recommendation

Update the authenticated application navigation to:

**Home · Matches · Upload · Improve**

Place the following in the top-right area:

**Notifications · Account avatar**

This should be delivered as one cohesive product overhaul. Improve should launch with a consolidated Notes workspace across every authorized match. The label should remain **Improve** so it can support broader improvement functionality later, while Notes remains the focus now.

The new structure should establish a durable product model:

- Home is a genuinely useful, personalized overview and next-action surface.
- Matches is the canonical visual library for processed matches.
- Upload remains a primary navigation destination and the dedicated place to submit new footage.
- Improve is the home for cross-match Notes now and broader development tools later.
- Notifications and Account move out of the mobile bottom navigation and remain readily available in the top-right area.

Implementation must be grounded in the current routes, permissions, data model, processing pipeline, and components.

---

## 1. Proposed application structure

| Placement | Destination | Responsibility |
| --- | --- | --- |
| Primary navigation | Home | Personalized next action, recent activity, active processing, recent notes, ready exports, and relevant product guidance |
| Primary navigation | Matches | Canonical visual match library with thumbnails, search, filters, processing states, and access to match review |
| Primary navigation | Upload | Dedicated workflow for uploading or importing new footage |
| Primary navigation | Improve | Consolidated Notes workspace across authorized matches |
| Top right | Notifications | Existing notification experience and unread-notification state |
| Top right | Account avatar | Account identity, preferences, storage, sharing, help, tutorials, legal information, and sign-out |

On mobile, the primary navigation should use a four-item bottom bar in this stable order:

**Home · Matches · Upload · Improve**

On wider screens, preserve the same destinations and order while adapting their presentation to the application’s existing desktop navigation pattern.

---

## 2. Core product concepts

### Upload

Upload is a primary action and should remain a primary navigation destination.

It is where users submit local or supported external footage, provide match metadata, review recording guidance, and begin processing. It is not a permanent library of original files; the durable result is the processed Match.

Upload may show immediate upload progress or the status of a submission that has just started. Broader processing awareness should also appear on Home so users do not have to remain on the Upload screen.

### Matches

Matches are the principal processed output. Their dedicated destination should let users browse, search, filter, and revisit match history, including metadata, review, points, notes, and exports.

Pre-launch or test data does not need to constrain this redesign. Legacy processed-only outputs that do not correspond to a current Match do not need a special preservation experience and may be removed or ignored during the overhaul.

### Notes

Notes already exist at both match and point level and can contain text, voice, or both. Improve should consolidate them across matches while preserving author and source context.

### Exports

Exports should remain accessible from their Match and may appear on Home when useful. They do not require primary navigation.

---

## 3. Home

Home should become PongLens’s personalized orientation and continuation layer, not a renamed full match inventory.

It should answer:

- What should I do next?
- What has changed since I last visited?
- What is currently uploading or processing?
- What match should I continue reviewing?
- What recent notes or coach activity are worth revisiting?
- What exports are ready?

Home should use real product state. Where required state does not exist—such as last viewed or review progress—the overhaul should add the minimum tracking needed.

### Recommended Home structure

Sections should appear only when they contain useful information.

#### 1. Primary next action

Show one prominent, state-aware action selected by this priority:

1. An upload or processing failure that requires action
2. An active upload or processing job
3. A new coach notification or note-related activity
4. A partially reviewed or recently viewed match that can be continued
5. A recently completed export
6. The most relevant recent match
7. Upload the first match

Examples include:

- Upload your first match
- Processing your latest match
- Continue reviewing your match against Alex
- Review a new coach note
- Open your completed export
- Revisit notes from your latest match

“Continue” must be based on recorded viewing or review activity, not merely recency.

#### 2. Recent matches

Show a small selection using the Matches library’s visual card language.

Each card may include:

- Generated match thumbnail
- Match title
- Match date
- Opponent, venue, or event context where available
- Processing status
- Review activity or progress where reliably supported
- Note count or recent note activity
- Export status

Provide a clear **View all matches** route to Matches.

#### 3. Active uploads and processing

Show active, failed, or incomplete work with progress where available, distinguishing normal processing from work requiring intervention. Hide the section when irrelevant.

#### 4. Improve snapshot

Make Improve discoverable through relevant activity such as:

- A recent note
- A recent coach note
- Notes added to the latest match
- A prompt to revisit notes from a recent match
- A note count from the most relevant recent match

For users without notes, explain that match-review notes will be collected in Improve. Per-note read indicators are unnecessary; Notifications remains the alert authority.

#### 5. Ready exports

Show useful completed exports with their match, type, and existing supported actions.

#### 6. Platform information

Keep announcements, tips, tutorials, and product updates visually below personal activity.

---

## 4. Home states

### New user

Prioritize:

- One clear Upload action
- A concise explanation of what PongLens produces
- Guidance on reviewing a match point by point
- A short introduction to Notes and Improve
- Recording guidance where useful

### User with active processing

Prioritize:

- Current processing state and progress
- Any failure or required action
- Other recent matches that remain useful while processing continues
- A clear next step

### Established player

Prioritize:

- Continue reviewing based on persisted activity
- Recent matches
- Recent Notes and coach activity
- Ready exports
- A relevant next action

### Coach

Where supported by the existing permission model, prioritize:

- Recently shared match activity
- Matches recently opened or reviewed
- Notes recently added by the player or another authorized coach
- Items requiring follow-up

All recommendations must respect existing match-access rules.

---

## 5. Matches

Matches should become the canonical, visual match library.

It should be easy to scan on mobile and make strong use of match imagery.

### Recommended structure

Provide:

- Thumbnail-oriented match cards
- Search
- A focused set of useful filters
- Sorting where it materially helps
- Clear processing and failure states
- Access to the existing match-review experience
- Clear distinction between a user’s own matches and matches shared with them where relevant

Keep less common controls in a compact filter panel.

### AI-selected thumbnails

Every eligible processed Match should receive a durable generated thumbnail.

Do not rely on one random frame. The system should:

1. Select multiple candidate timestamps from suitable portions of the match, preferably using known playable or point ranges when available.
2. Extract candidate frames from the processed video.
3. Reject unsuitable frames, including severe blur, fades, blank frames, obstructed views, empty scenes, and poor table visibility.
4. Use an automated visual-quality or AI-selection step to choose the strongest representative frame.
5. Store the selected thumbnail in durable media storage and associate it with the Match.
6. Provide a designed fallback when thumbnail generation is pending or fails.

Thumbnail processing, storage, association, private access, and fallbacks are all in scope.

### Search and filters

Search should cover names, venue, match type, and date.

Initial filters may include:

- Processing state
- Match type
- Date range
- Own matches or shared matches
- Matches with notes

### Match card information

Use a concise combination of:

- Thumbnail
- Derived match title
- Date
- Opponent, venue, or match type
- Processing status
- Review progress where supported
- Note count or note activity
- Export status

### Notes within Matches

Users should be able to see when a match contains notes. A card or match header may show a total note count, coach-note presence, or recent note activity.

A **View notes** action should route to Improve with the relevant match filter applied. No per-note unread state is required.

---

## 6. Improve

Improve should launch as a primary destination in this overhaul.

Its current purpose is:

**View notes across matches over time while retaining enough context to understand and use each observation.**

Tapping Improve should open directly into the consolidated Notes workspace. The primary-navigation label should remain Improve, while the page itself should make **Notes** visually prominent.

No future Improve modules are in scope, but the architecture should not prevent later additions.

---

## 7. Consolidated Notes workspace

### Primary goals

The workspace should help users:

- View notes across every authorized match
- Identify the author
- Distinguish match-level and point-level notes
- Find recent notes
- Filter notes to a specific match
- Separate their own notes from coach notes
- Return to the originating match or point
- Review text and voice notes together

### Default view

Show recent notes across all accessible matches, newest first, with pagination or incremental loading.

A grouped-by-match view may supplement, but not replace, the chronological default.

### Note card information

Each note should show the available subset of:

- Text preview
- Voice-note indicator and playback
- Author
- Match title
- Match date
- Match-level or point-level context
- Point number or timestamp where reliable
- Created date

Per-note read state is not required; Notifications already alerts users.

### Note actions

Users should be able to:

- Open the note in context
- Return to the related match
- Return to the related point when the note is point-level
- Play voice audio through the existing authorized media flow
- Use edit or delete behavior only where supported and permitted

### Filters

Useful initial filters include:

- All notes
- My notes
- Coach notes
- Match-level notes
- Point-level notes
- Voice notes
- Text notes
- Match
- Date

### Data-layer requirements

The Notes workspace requires a permission-safe, paginated cross-match retrieval path. The implementation should:

- Return only notes from matches the viewer is authorized to access
- Retrieve match and point context efficiently
- Resolve author names in bulk rather than issuing one author query per match
- Support recent-first ordering and the approved filters
- Add the indexes needed for recent-note retrieval at realistic scale
- Avoid exposing private authentication records
- Preserve existing voice-note authorization
- Use stable match and point identifiers for deep links

Elevated database functions must explicitly re-check current-user match access.

### Empty state

For users without notes:

- Explain that notes are created while reviewing a whole match or an individual point.
- Explain that text and voice notes will appear together in Improve.
- Provide a route to Matches when matches exist.
- Provide a route to Upload when the user has no matches.

---

## 8. Account

Move Account out of the mobile bottom navigation and place it behind the top-right avatar on all authenticated layouts.

Account should preserve:

- Identity and sign-out
- Storage and quota information
- Coach-sharing management
- Public share-link management
- Existing administrative controls where authorized
- Feedback
- Privacy Policy
- Terms and Conditions

It should also provide clear access to:

- Preferences that are actually supported
- Help and contact
- Tutorials and product guidance

Tutorials should cover uploading, recording setup, point review, Notes, coach sharing, and exports. Follow the current design system; do not add a content-management system solely for this.

---

## 9. Responsive and navigation behavior

The experience should support:

- Four labeled mobile bottom-navigation destinations
- Clear selected states
- Stable destination order
- Safe-area spacing
- Accessible touch targets
- Keyboard navigation
- Screen-reader labels
- Correct browser Back behavior
- Addressable routes
- Preservation of useful local state when switching destinations

Match detail routes should activate Matches—not Home—in the primary navigation.

Leaving Upload during an active submission must continue to use the application’s existing upload-leave protection.

---

## 10. Performance and data-loading requirements

Do not reproduce the current dashboard’s broad polling on every destination. Each should request only what it needs:

- Home should retrieve limited summary data.
- Matches should retrieve a paginated or bounded library result.
- Improve should retrieve paginated Notes with joined display context.
- Active processing may poll at a reasonable interval only while relevant jobs exist.
- Static or completed datasets should not be repeatedly refetched every few seconds.

Do not load every point solely to draw library summaries. Use targeted queries or aggregates for scores, progress, note counts, and thumbnail status.

Loading, empty, partial-failure, and retry states should be designed for each destination.

---

## 11. Scope of the unified overhaul

This is one unified product change and should include:

1. Change primary navigation to Home, Matches, Upload, and Improve.
2. Move Account to the top-right avatar.
3. Keep Notifications in the top-right area.
4. Redesign Home as a genuinely personalized overview.
5. Add the activity tracking required for accurate continuation recommendations.
6. Add a dedicated visual Matches library.
7. Add automated candidate extraction and AI-selected thumbnails.
8. Add search, useful filters, sorting, and clean processing states to Matches.
9. Surface note activity within Matches.
10. Add Improve with a consolidated cross-match Notes workspace.
11. Add efficient, permission-safe backend retrieval for consolidated Notes.
12. Support navigation from Notes back to the relevant match or point.
13. Preserve existing voice-note playback and note creation.
14. Update Account while preserving storage, sharing, links, admin, legal, and sign-out behavior.
15. Add or update empty and loading states across the new structure.
16. Replace broad duplicated polling with destination-specific data loading.
17. Preserve Upload, Notifications, Exports, match review, sharing, and coach access.

The overhaul should not include:

- Training
- Drills
- Progress programs beyond review-continuation state
- Coaching programs
- External integrations
- A redesign of the note composer
- New export workflows
- Subscription or billing functionality
- Per-note read or unread tracking
- A final long-term internal navigation model for Improve
- Special migration or presentation of disposable pre-launch legacy data

---

## 12. Acceptance criteria

### Navigation

- Mobile navigation reads Home, Matches, Upload, and Improve.
- Wider layouts preserve the same information architecture.
- Account is accessible from the top-right avatar.
- Notifications remain in the top-right area.
- Match routes select Matches in navigation.
- Selected states, browser history, upload-leave protection, and accessibility work correctly.

### Home

- Home is a personalized overview rather than a complete library.
- The primary action follows an explicit state-priority model.
- New users see useful guidance without empty sections.
- Active processing appears only when relevant.
- Continue-review actions are based on persisted activity, not guessed from recency.
- Recent Matches, Improve activity, and ready Exports link to their source experiences.
- General product information remains lower priority than personal activity.

### Matches

- Matches has a dedicated route and visual library.
- Eligible matches receive durable AI-selected thumbnails.
- Thumbnail processing has pending and failure fallbacks.
- Search and useful filters work without overcrowding mobile layouts.
- Own and shared matches remain understandable.
- Processing and failure states are clear.
- Existing match review continues to work.
- Note presence is visible and can link into filtered Improve results.

### Improve

- Improve opens directly to Notes.
- Notes are loaded across all authorized matches with pagination.
- Match-level and point-level notes are distinguishable.
- Text and voice notes retain their types.
- Authors and match context are shown correctly without per-match query fan-out.
- Users can return to the relevant match or point.
- Filters work on reliable data.
- No per-note unread state is displayed or required.
- Empty states explain how Notes are created.
- No future Improve modules are included.

### Account

- Account is removed from mobile bottom navigation.
- Existing storage, sharing, public-link, admin, feedback, legal, and sign-out behavior remains accessible.
- Help, contact, and tutorial guidance are accessible.

### Performance and security

- Home, Matches, and Improve use bounded, destination-specific queries.
- Large collections are paginated or incrementally loaded.
- Polling is limited to state that can actively change.
- Thumbnail and voice media remain private and authorization-checked.
- Notes never expose data outside existing match permissions.
- Any new elevated database function explicitly validates the current viewer’s access.

### Regression protection

- Upload and external import flows continue to work.
- Notifications continue to work.
- Exports continue to work.
- Match review and point navigation continue to work.
- Existing match-level and point-level note creation continues to work.
- Voice-note playback continues to work.
- Sharing and coach access continue to respect existing permissions.

---

## 13. Pre-implementation analysis

Before implementation, review the current codebase and produce a concise technical analysis covering:

1. Current authenticated navigation, routes, and selected-state behavior
2. Current dashboard responsibilities and data loading
3. Existing match list, search, shared-match grouping, and match detail components
4. Upload and import flows, active-upload protection, and processing state
5. Match media storage and the best integration point for thumbnail extraction
6. Candidate-frame generation, AI selection, storage, and failure handling
7. Current Notes schema, RLS policies, retrieval, author attribution, and voice playback
8. Existing point deep-link behavior
9. The backend query or RPC required for paginated cross-match Notes
10. Activity fields required for last-viewed and continue-review recommendations
11. Current Account, storage, sharing, public-link, and admin functionality
12. Queries that should be split, bounded, aggregated, or stopped from polling
13. Exact routes, components, migrations, worker changes, and API changes required
14. Risks to Upload, Notifications, Exports, match review, sharing, and Notes
15. A single implementation plan for the complete overhaul

Implementation should then deliver the unified scope in this document without expanding into speculative future Improve modules.
