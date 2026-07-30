# Hosted Serve Detection Research Design

**Status:** Approved in conversation on 2026-07-30

**Production route:** `/research/serve-detection`

**Evaluation scope:** 100 points across five production matches

## Objective

Replace the temporary localhost serve-detection lab with a permanent,
authenticated PongLens research page that can be reviewed by the owner or
delegated to other reviewers.

The first evaluation batch must contain exactly 100 real point clips drawn
evenly from five different matches and camera setups. The page should make the
small amount of high-value labeling fast, persist every answer, and keep the
detector's prediction independent from the scoring information used to
evaluate it.

## Chosen Approach

Extend the existing production research infrastructure rather than deploy a
static report or add research controls to customer match pages.

This approach reuses:

- authenticated `/research/*` pages;
- reviewer and batch assignment records;
- row-level access controls;
- protected private-video delivery from R2;
- autosaved JSON labels; and
- existing administration and export mechanisms.

A static hosted report would be simpler but would not provide durable
account-specific labels, delegation, or private-media protection. Adding this
directly to normal match pages would mix unfinished research behavior into the
customer product.

## Source Batch

Create batch `serve-detection-cross-match-v1` with 20 points from each of:

- Vaibhav;
- Gui;
- Chris;
- Faye; and
- Patrick.

The current production reconstructions yield the following target mixture:

- 36 `high_confidence` predictions; and
- 64 `needs_review` predictions.

Unavailable predictions are excluded. Selection is deterministic so the batch
can be reproduced:

1. rank eligible points using a stable anonymous point hash;
2. include up to ten high-confidence points per match;
3. fill the remaining match quota by round-robin selection across
   `needs_review` failure reasons; and
4. use a stable shuffled order for reviewer assignments.

There are no hidden repeats in this first 100-point batch. The goal is breadth
across clips and camera setups, not inter-reviewer agreement measurement.

## Independence and Scoring Truth

The serve detector runs only from the stored placement reconstruction. It must
not receive:

- the user's first-server selection;
- score-derived server rotation;
- the point winner; or
- previous reviewer labels.

Separately, the batch builder computes the expected server using the confirmed
first server and the same ITTF rotation rules as the application, including
per-game alternation, deuce, lets, server overrides, game-boundary overrides,
and side swaps.

This expected server is evaluation truth, not detector input. The review page
may show it as read-only context so the reviewer does not spend time answering
an already-known question. The canonical value is also stored with the
batch's gold metadata for administrative exports.

“Rerun the process” means applying the latest serve selector to the latest
stored placement reconstruction for every eligible production point. It does
not mean reprocessing every original match video through the placement
pipeline. This is faster, reproducible, and evaluates the selector being
studied without altering production match data.

## Batch Builder

Add a dedicated local administrative builder that:

1. reads the five explicitly configured matches and active points;
2. reconstructs authoritative scored-server context independently;
3. runs the current commercially unrestricted serve selector;
4. selects the deterministic 20-per-match sample;
5. downloads each private point clip and measures its duration, FPS, and frame
   count;
6. uploads an immutable research copy under
   `research/serve-detection/v1/sources/<stable-id>.mp4`;
7. writes the research batch, source proposals, gold metadata, and initial
   assignments; and
8. prints a manifest and validates that the batch contains exactly 100 unique
   sources with the intended match and status counts.

The builder is idempotent for the versioned batch ID and stable source IDs.
It never updates or deletes original matches, points, clips, scores, or
placement data.

## Research Page

The permanent page lives at:

`https://www.ponglens.com/research/serve-detection`

It requires sign-in and an assignment to the batch. Unassigned users receive
the same unavailable behavior as the existing research pages. Search engines
must receive `noindex`, `nofollow`, and no-cache metadata.

### Queue and progress

The page shows:

- completed and remaining counts;
- current match and detector status;
- match and status filters;
- compact next/previous navigation; and
- an administrative reviewer-email control that uses the existing batch
  assignment flow.

Delegating the batch gives the new reviewer an independent 100-assignment
queue. Reviewers do not overwrite each other's labels.

### Video and frame controls

Only the selected clip is mounted. The player uses the protected media route
and byte-range-compatible private R2 delivery.

Controls include:

- exact jumps to each proposed action timestamp, with no added padding;
- frame steps of -3, -2, -1, +1, +2, and +3 using the clip's measured FPS;
- play/pause and the native scrubber; and
- adding a missing event at the current frame.

The page must not preload or embed all 100 videos.

### Highest-value labels

The primary answer is deliberately small:

- mark the actual serve paddle-contact frame; or
- choose `No observable serve`.

Reviewers may additionally label proposed or manually inserted events as:

- serve paddle contact;
- serve first bounce;
- serve second bounce;
- return paddle contact;
- return bounce;
- later rally paddle contact;
- later rally bounce;
- net contact;
- non-relevant; or
- unsure.

For false action candidates, one-tap hard-negative reasons are:

- walking or ball retrieval;
- player handoff or casual toss; and
- bad clip boundary or cut.

The review page displays the authoritative scored server and the independent
detector prediction/status. It does not ask the reviewer to relabel the known
server.

### Saving

Changes autosave after a short debounce to the reviewer's assignment
`human_label`. A visible saved/saving/error state prevents silent loss.
`Submit & next` performs an immediate save before advancing. Reloading,
switching devices, or reopening the page restores the latest saved label.

## Proposal and Label Contracts

The source proposal is versioned JSON and contains only review-safe data:

- schema version;
- detector version, status, reason, confidence class, and predicted physical
  server side;
- a bounded list of likely actions and exact timestamps;
- clip duration, FPS, and frame count;
- anonymous match stratum and display label; and
- the read-only scored-server context.

The human label is versioned JSON and contains:

- actual serve-contact timestamp or no-observable-serve reason;
- labeled proposed events;
- manually added events;
- optional hard-negative reasons;
- reviewer completion state; and
- client save metadata.

Production match and point UUIDs are not returned to the browser. The
administrative gold/export record retains the private source mapping and
authoritative server value.

## Security and Privacy

- Research clips remain in private R2 storage.
- The media endpoint issues a presigned URL only after assignment and RLS
  access checks.
- The allowed media-key validator is expanded only for the versioned
  `research/serve-detection` namespace, not a broad research wildcard.
- The browser receives no service-role credentials.
- The local batch builder obtains privileged credentials from the existing
  administrative environment.
- The page and API routes do not expose unrelated production match data.

## Performance

- Mount one video player at a time.
- Fetch compact assignment/proposal metadata once and update labels
  incrementally.
- Keep likely-action payloads bounded.
- Use the measured clip FPS for frame stepping rather than decoding an entire
  video in the browser.
- Reuse protected R2 range delivery and immutable source objects.
- Avoid live detector execution in the browser or web server; all model
  outputs are prepared by the batch builder.

## Failure Handling

- Missing or invalid placement reconstructions are excluded before sampling.
- Missing clips, invalid media metadata, duplicate sources, incorrect
  per-match quotas, or incorrect total counts fail the builder before the
  batch is published.
- A failed autosave stays visibly unsaved and can be retried without losing
  the in-memory label.
- An expired media URL is refreshed through the protected media endpoint.
- A proposal may be withheld or `needs_review`; the UI still permits manual
  serve-contact labeling.
- Re-running the builder is idempotent and must not duplicate assignments or
  media.

## Testing and Verification

Automated verification covers:

- deterministic 20-per-match sampling and the 100-source invariant;
- selector independence from scoring truth;
- ITTF rotation, deuce, lets, overrides, and game transitions;
- proposal and human-label validation;
- frame-step timestamp calculations;
- autosave hydration and retry behavior;
- assignment/RLS authorization;
- serve-detection media-key allowlisting and rejection of unrelated keys;
- protected media access;
- no production IDs in the client payload; and
- idempotent builder behavior.

Before deployment:

1. run focused worker and web tests;
2. run lint and the production Next.js build;
3. seed the versioned batch and inspect its manifest;
4. apply the database migration;
5. deploy the clean branch through the normal production path; and
6. verify authentication, one full labeling flow, persistence, delegation,
   private video playback, and export on the live route.

## Rollout

Implementation starts from a clean branch based on `main`. Only the serve
selector and focused tests required from the experimental branch are carried
over; the large experimental branch itself is not merged.

The migration adds the serve-detection research namespace and any narrowly
required database helpers. The batch is generated locally, copied to private
research storage, and assigned to the owner. The web change is then merged to
`main`, where the existing Vercel production workflow hosts it permanently.

## Non-goals

This version does not:

- change normal Keep Score behavior;
- automatically decide first server in customer matches;
- modify the placement pipeline;
- rerun raw-video placement reconstruction;
- expose research videos publicly;
- measure inter-reviewer agreement with repeated clips; or
- deploy the unrelated contents of the experimental branch.
