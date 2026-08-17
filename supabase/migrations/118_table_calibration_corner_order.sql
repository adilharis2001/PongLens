-- Settle the corner-order disagreement in the hand-marked calibration truth.
--
-- The review page asked for four corners and never said which was which. The
-- marks are cyclic and the POSITIONS are correct on all 62 frames, but on 7 of
-- them the letters start one position round: what the rest of the pipeline
-- calls the near end line, A-B, was drawn along a side line instead.
--
-- Two independent tests agree on all seven, and neither one uses the detector:
--
--   * Zhang & He rectangle recovery reads the implied length:width straight
--     off the four image corners. As marked they read 0.30-0.66, meaning a
--     table wider than it is long. Rotated one position, five of the seven
--     read 1.52-1.77 against a true 1.7967.
--   * The apparent pixel ratio of the two edge pairs, which involves no
--     perspective mathematics at all, says the same thing on six of seven.
--     The seventh (8de4d737) is 1.01 vs 0.99 — a coin toss in pixels, and
--     decisively 1.773 under the perspective test.
--
-- Two frames (74d2b8db, b1c26326) rotate to 3.35 and 2.70 rather than to
-- 1.80. Both readings are reciprocals of each other, so the LABELLING answer
-- is still unambiguous — only the rotated one puts the long axis where a
-- table's long axis goes — while the magnitude says those two quads are drawn
-- a little loose, or sit near the head-on degeneracy where the recovery stops
-- being trustworthy. Rotating them is right; treating their implied ratio as
-- evidence about anything else is not.
--
-- What Adil drew is preserved in corrected_corners_as_marked. Nothing here
-- moves a point: the four positions are identical, only their order changes.
--
-- Production is unaffected. The world mapping derives near and far from image
-- position (points_pipeline._orient_near_far), never from these rows, which
-- exist to MEASURE the detector rather than to feed it.

alter table public.table_calibration_review
  add column if not exists corrected_corners_as_marked jsonb;

comment on column public.table_calibration_review.corrected_corners_as_marked is
  'The corner order exactly as drawn in the review UI, kept because '
  'corrected_corners was canonicalised by migration 118. Null means the two '
  'were already the same.';

update public.table_calibration_review
set corrected_corners_as_marked = corrected_corners,
    corrected_corners = jsonb_build_array(
      corrected_corners -> 1,
      corrected_corners -> 2,
      corrected_corners -> 3,
      corrected_corners -> 0
    ),
    updated_at = now()
where corrected_corners is not null
  and corrected_corners_as_marked is null
  and left(match_id::text, 8) in (
    '8de4d737',   -- LYTTC, Victoria          0.564 -> 1.773
    '74d2b8db',   -- LYTTC, Yair              0.298 -> 3.352   (loose quad)
    '19a1efc7',   -- PingPod, Julian          0.637 -> 1.570
    'f070a568',   -- PingPod, Vaibhav         0.599 -> 1.670
    'e009b852',   -- Westchester, Patrick     0.660 -> 1.516
    'becf0e21',   -- Santosh (recut 08-13)    0.580 -> 1.723
    'b1c26326'    -- unlabelled               0.370 -> 2.702   (loose quad)
  );

-- State the convention on the table itself, so the next person marking
-- corners does not have to reconstruct it from a chat log.
comment on column public.table_calibration_review.corrected_corners is
  'Four table corners in SOURCE pixels, cyclic: A near-left, B near-right, '
  'C far-right, D far-left. Near is the end line closest to the camera, and '
  'left/right are as the camera sees them, so A-B is always a 1.525 m end '
  'and B-C is always a 2.740 m side.';
