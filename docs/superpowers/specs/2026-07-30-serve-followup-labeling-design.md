# Serve Detection Follow-up Labeling Design

**Status:** Approved in conversation on 2026-07-30

**Production route:** `/research/serve-detection`

## Objective

Turn the first 100 reviewed serve clips into a smaller, higher-value second
pass that explains why the current detector succeeds or fails. Preserve every
original answer, select exactly 42 existing sources, collect the missing
sequence anchors, and export the detector proposal beside the human truth.

The follow-up should answer whether a commercially usable serve detector can
reliably combine:

- an exact or plausible serve-contact time;
- the first bounce;
- the second bounce; and
- the receiver's first paddle contact.

## Selected Cohort

The follow-up is a deterministic subset of the existing
`serve-detection-cross-match-v1` batch:

1. all 23 sources labeled `not_visible`;
2. all ten high-confidence sources whose predicted server disagreed with the
   scored server, with one overlap from the first group, yielding nine
   additional sources; and
3. ten visible, correctly predicted controls, exactly two from each of the
   five matches.

This yields exactly 42 unique sources. The selected cohort is stored under
`research_sources.prefill.followup_v2`, including inclusion, reason tags, and
stable follow-up order. It does not create a new media copy, batch, assignment,
or reviewer.

## Label Contract

The existing human-label document is upgraded additively. These original
fields remain canonical and unchanged:

- `actual_serve_contact_s`;
- `no_observable_serve`;
- `events`; and
- `notes`.

A new `followup` object contains:

- `first_bounce`: exact timestamp or `not_visible`;
- `second_bounce`: exact timestamp, `not_visible`, or `does_not_occur`;
- `receiver_contact`: exact timestamp, `not_visible`, or
  `does_not_occur`;
- `contact_window`: optional earliest and latest plausible contact timestamps
  for an occluded serve; and
- `net_contacts_s`: zero or more optional exact timestamps.

An approximate occluded contact must never be written into
`actual_serve_contact_s`. The exact visible-contact truth and the plausible
occluded interval are different evidence classes.

Hydration accepts the current schema-version-one documents and adds an empty
follow-up object without losing data. Autosaves write the additive document
back to the same assignment.

## Completion Rules

A follow-up answer is complete when:

- first bounce is exact or not visible;
- second bounce is exact, not visible, or did not occur;
- receiver contact is exact, not visible, or did not occur; and
- a contact window is either absent or has both valid boundaries in
  chronological order.

Net contact is optional. The contact window is optional and presented only as
an extra control for clips whose original serve contact was not visible.

Follow-up completion is stored inside the follow-up object and is independent
of the assignment's original `submitted` status.

## User Experience

The existing production route opens in **Follow-up 42** mode by default. A
compact mode switch allows reviewers to return to **Original 100** without
losing either pass.

The follow-up view:

- mounts only the selected clip;
- shows the original exact-contact or not-visible answer;
- keeps frame-step and playback controls;
- provides one-tap “mark here” controls for first bounce, second bounce, and
  receiver contact;
- provides explicit not-visible and did-not-occur choices;
- allows optional net-contact timestamps;
- allows earliest/latest plausible contact bounds for occluded clips;
- shows follow-up progress separately from original progress; and
- saves before moving to the next incomplete follow-up.

The queue retains match and detector-status filters. Each follow-up source
shows why it was selected: occluded, high-confidence wrong-server, or control.

## Export

The administrative batch export must include, for every assignment:

- the existing human label;
- the source proposal;
- the source prefill, including follow-up selection metadata; and
- the existing gold label.

The database export remains admin-only and uses the current security-definer
function with its existing authorization gate. The download filename should
derive from the batch slug rather than use a fused-labeling-specific name.

## Cohort Builder

Extend the existing serve research builder with a follow-up command that:

1. reads the exported first-pass JSON;
2. joins source proposals and gold labels;
3. derives the 23 occluded sources and ten high-confidence disagreements;
4. chooses two deterministic correct visible controls per match;
5. verifies the exact 42-source and five-match invariants;
6. writes `prefill.followup_v2` only for the existing 100 sources; and
7. prints a reason-count audit.

The command must preserve unrelated prefill keys and must not update original
match, point, placement, clip, assignment, or human-label data.

## Security, Privacy, and Performance

- The clips remain private and use the existing assignment-protected media
  route.
- No production match or point UUID is added to the browser response.
- No detector or model runs in the browser or Next.js server.
- Only one video is mounted at a time.
- The existing 100 compact assignment records are acceptable to load once;
  the default rendered queue contains only 42.
- Existing reviewer RLS and admin-only export controls remain in force.

## Rollout

1. Add tests and additive label/view contracts.
2. Add the follow-up UI.
3. Add and apply the export migration.
4. Mark the 42 production sources through the builder.
5. verify database counts and export shape;
6. deploy the route to production; and
7. verify anonymous access still redirects to login.

No original answer is reset. If the follow-up is later abandoned, removing
the mode from the UI leaves the original 100-answer experiment intact.

