# Manual, Scored Highlight Generation

## Purpose

PongLens must stop generating a highlight video automatically when normal
match processing finishes. Normal processing happens before the player can
score the match, so an automatically rendered reel cannot use the player's
confirmed point outcomes or scoring taps. It is therefore the worst moment to
commit compute and publish a reel.

Normal processing will continue to create the rally cards, point clips, and
versioned highlight evidence needed later. Highlight selection and video
encoding will happen only after an explicit request from the match owner.

## Product rule

A player may request highlights when all of the following are true:

- the match is ready and has a playable cut;
- the match type supports scoring;
- no edited rally clips are still being prepared;
- at least 75% of the match's scorable points have a confirmed winner.

The score coverage calculation uses only active-version points:

- deleted points are excluded;
- points marked Skip/Let are excluded;
- every remaining point is scorable;
- a scorable point is scored when `confirmed_winner` is `user` or
  `opponent`;
- eligibility is exact: `scored_points * 4 >= scorable_points * 3`;
- a match with no scorable points is not eligible.

Once the match is eligible, the selector may use only scored rallies. The
existing quality evidence rules still apply after that restriction. This is
necessary because merely unlocking at 75% while allowing the remaining 25%
into the selector would preserve the current failure: an unscored long rally
could rank highly and use an entirely detected ending.

Where `scored_at_cut_s` exists, it remains the authoritative rally ending.
The existing 0.2-second scoring-tap tail remains unchanged. A scored rally
without a tap timestamp may use the existing measured rally ending and
0.25-second detector tail.

## Processing and request flow

### Normal match processing

The points pipeline continues to gather and persist `highlight_evidence` for
each final rally card. This includes matches assembled by the body pipeline:
the body-derived cards remain the cards of record, while the ball pipeline's
crossings, bounces, hits, and observed ending remain attached as evidence.

The normal worker will no longer call the automatic highlight preparation
function before marking the match ready. It will not create a
`match_reels/highlights` row, render an MP4, upload a reel, or book reel
storage. Removing this call applies to every ordinary processing location
because the Mac and Modal workers execute the same sealed worker release.

### Reading highlight state

Opening the Highlights row remains read-only. The GET route calculates
current score coverage and inspects any existing reel, but it never enqueues
work.

For a match without a usable reel:

1. Below 75%, GET returns `needs_scoring` with `scoredPoints`,
   `scorablePoints`, `requiredPoints`, and `requiredPercent: 75`.
2. At or above 75%, GET returns the existing `needs_generation` state.
3. Opening either state changes no database row and spends no worker compute.

For a stale reel, the same gate applies before `needs_update` is actionable.
For an in-flight request, the existing `rendering` and `updating` states take
priority so a user is not invited to submit a duplicate request.

### Requesting highlights

The existing POST route remains the only owner-facing entry point. It checks
ownership, readiness, clip state, feature availability, and score coverage,
then calls the existing `enqueue_reel` path with scope `highlights`.

Eligibility is enforced at three boundaries:

1. The API returns an explanatory response instead of enqueueing an
   ineligible request.
2. `enqueue_reel` rejects an ineligible highlights scope, protecting the
   service from old app builds and direct requests.
3. The worker checks eligibility again immediately before evidence recovery
   or rendering. If scoring was undone while the job waited in the queue, the
   worker stops before expensive work and the GET route presents
   `needs_scoring` rather than a generic failure.

The database owns one score-coverage function used by the enqueue guard and
the worker. The authenticated API may read that result only after it has
verified that the caller owns the match. The function is not exposed to
anonymous users. It also rejects stored match types `drills` and `practice`,
matching the existing `tracksServe` rule on web and iOS; an unset or ordinary
match type remains scoreable for backward compatibility.

## Selection and artifact freshness

The worker's highlight-point query gains `confirmed_winner`. Qualification
rejects a point unless it has a confirmed winner in addition to satisfying
the current five-exchange, two-table-bounce, playable-boundary, and evidence
requirements.

New manifests carry an additive `scored_only: true` marker while retaining
the existing manifest version and rule string. This keeps released iOS builds
able to decode new reels. For these manifests, the points revision includes
whether each point is scored, but not which player won. Scoring or unscoring a
point can change membership and must make the reel stale; correcting the
winner from one player to the other does not change the video and must not
force a rerender.

Existing ready manifests without `scored_only` use the legacy revision
calculation and remain playable. They are not deleted or made stale merely by
this release. Once an old reel genuinely becomes stale and is updated, its
replacement uses the scored-only rule.

Existing `empty` or failed automatic results are not valuable artifacts to
grandfather. Below the threshold they present `needs_scoring`; at or above it
they can be explicitly generated again under the new rule.

## Feature availability

The existing private `automatic_highlights` setting currently controls two
unrelated things: whether highlights are available and whether processing
creates them automatically. A migration introduces the private
`highlights_enabled` setting and copies the existing global or canary value.
The API reads `highlights_enabled`. Normal processing has no automatic
generation branch at all.

The 75% threshold is versioned product behavior, not a mutable production
setting. Changing it requires a code and migration review rather than a
silent configuration edit.

## Web experience

The web uses the existing Tools row and existing bottom-sheet/dialog pattern.
No new button, pill, color, card, or spacing system is introduced.

Below the threshold:

- the Tools row summary is `<scored> of <scorable> scored`;
- opening the row shows the title `Score more of this match`;
- the body says `Score at least 75% of the points before generating
  highlights. You've scored <scored> of <scorable>.`;
- the single cyan primary action is `Score the Match` and opens the existing
  scorekeeper;
- on mobile web the action fills the content width and is at least 44px high.

At or above the threshold, the existing `Generate highlights?` sheet and
full-width `Generate highlights` action remain unchanged. Preparing, ready,
sharing, and update states retain their current presentation.

The implementation must reuse the current `PlacementToolsRow` request sheet
and the approved allowance components as visual references. Desktop and
393x660 mobile web must be inspected separately.

## iOS experience

iOS presents the same states and wording as web. The existing Form-based
Highlights request sheet and the placement-generation sheet are the native
visual references. The implementation uses the existing PongLens fonts,
surface colors, section treatment, cyan tint, navigation title, Done action,
and spacing.

`Score the Match` and `Generate highlights` are ordinary form actions. Their
labels are sized before the existing PongLens button treatment so the visible
button and hit area both fill the available width and provide at least a
44-point target. No custom pill or nested bordered card is added.

The score action dismisses Highlights and opens the existing scorekeeper. It
does not create a second scoring screen. Native iOS is verified separately in
the simulator; a responsive web screenshot is not accepted as iOS evidence.

## Existing matches and edits

- A current ready reel remains playable even when the match is now below
  75% scored.
- A missing historical reel never starts merely because Highlights was
  opened.
- A stale reel can be regenerated only when the current match meets the
  threshold.
- Splits, joins, timing changes, deletions, Skip/Let changes, and scoring or
  unscoring points continue to participate in the reel revision.
- Reaching 75% does not enqueue anything. The player must still press
  `Generate highlights`.
- Falling below 75% does not delete a current ready reel or its R2 object.

## Failure handling

- A request made below the threshold returns a stable
  `highlights_score_required` code with the current coverage values.
- A queue-cap response keeps the existing calm retry message.
- A change between scored and unscored during rendering prevents publication
  of a now-invalid artifact and returns the match to the appropriate request
  state. Correcting which player won without unscoring the rally does not
  invalidate the video.
- Evidence recovery remains fail-closed: missing or untrustworthy evidence
  never turns into a weak rally merely to fill the reel.
- Highlight failure never changes the match's ready state.

## Verification

Automated verification covers:

- exact eligibility at 0%, below 75%, exactly 75%, and 100%;
- deleted and Skip/Let points in the denominator;
- active processing-version isolation;
- GET remaining read-only in every lifecycle state;
- API and database rejection below 75%;
- the worker stopping before evidence recovery and FFmpeg when queued work
  becomes ineligible;
- normal match processing persisting evidence without creating or rendering
  a reel;
- scored-only qualification and revision behavior;
- grandfathering existing ready manifests;
- split, join, and score changes producing the correct stale state;
- identical lifecycle copy on web and iOS.

Release verification includes the focused TypeScript and Python suites, the
real `npm run build`, the native iOS unit tests and simulator build, visual
inspection of desktop web, 393x660 mobile web, and native iOS, and parity of
the sealed Mac and Modal worker release before either worker processes the
new job policy.

## Rollout

1. Apply a behavior-neutral migration that adds the score-coverage function
   and copies the existing rollout value to `highlights_enabled`.
2. Deploy the web/API and both worker locations with manual-only generation
   and the API-level eligibility gate.
3. Apply the enqueue guard after the new API is live, so an older client sees
   the API's stable response rather than a temporary unexplained database
   error during rollout.
4. Verify a below-threshold canary cannot enqueue from web, iOS, or a direct
   RPC call.
5. Verify a canary at exactly 75% sees the existing generation action and no
   job exists until it is pressed.
6. Verify the resulting manifest contains only scored rallies and uses a
   scoring tap wherever one exists.
7. Release the iOS build after simulator and native tests pass.
8. Retain `automatic_highlights` temporarily for rollback compatibility, then
   remove it in a later cleanup after every worker release reads
   `highlights_enabled`.
