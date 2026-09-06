# PongLens-owned ball model: experiment record and continuation specification

**Status:** Research only. The preliminary local detector is worse than Gemini and is not approved for production. BlurBall remains unchanged in the released processing path.

**Objective:** Build a PongLens-owned model that tracks the ball belonging to the selected table through 30 and 60 fps player-uploaded and iPhone footage, including motion-blurred frames, held balls, partial occlusion, busy venues and other active tables. The finished model must replace the need for BlurBall in PongLens. Training and routine inference development happen on Adil's Mac Studio. Any future production release must use the same immutable pipeline package on the Mac Studio and Modal backup worker.

This document is the durable handoff for the work. An agent continuing the experiment should read `CLAUDE.md`, this file, the two September 5 research records linked below, and the frozen artifacts before spending money or training another model.

## The conclusion so far

The work has established three useful facts.

1. Gemini 3.8 Flash can usually locate a visible ball much better than the first PongLens-owned detector when it is given original-resolution adjacent frames, a short clip and selected-table coordinates. On the 178 reviewed frames, Prompt 3 located 100 of 109 visible references within 20 source pixels.
2. Training a normal one-frame detector on 810 Gemini center points produced a model that was precise when it fired but missed too many balls. It located 70 of 109 visible human references within 20 pixels and made 14 visible predictions on 69 non-visible references. This is a workable training pipeline, not a competitive model.
3. The next gain is unlikely to come from running the same center-label experiment at a slightly larger scale. The labels and model must represent the blur and the sequence. A fixed 32-pixel square around a center teaches the model to treat a long streak as though it were a small round object, which matches the observed failure on blurred balls.

The recommended next system uses a general vision model as a label generator and adjudicator, a prompted segmentation/tracking model to propagate dense masks, and a compact PongLens temporal model for production. Gemini remains the first teacher candidate. Qwen3-VL is the most relevant independent challenger. SAM 3.1 is a candidate propagation tool, not a substitute for selected-table identity reasoning.

## Canonical locations

### Repository

- Continuation branch: `codex/active-ball-release`
- Continuation worktree: `/Users/adil/Desktop/Projects/PongLens/.worktrees/active-ball-release`
- This handoff directory: `docs/research/2026-09-06-ponglens-ball-model/`
- Original active-ball record: `docs/research/2026-09-05-active-ball/README.md`
- Gemini comparison record: `docs/research/2026-09-05-gemini-active-ball/README.md`
- Scale experiment design: `docs/superpowers/specs/2026-09-05-active-ball-scale-design.md`
- Scale implementation plan: `docs/superpowers/plans/2026-09-05-active-ball-scale.md`

The first worktree at `.worktrees/active-ball-pilot` was based on a divergent checkout and must not be deployed. The current `main` checkout contains unrelated uncommitted work. Continue in the release worktree or a new worktree derived from its branch.

### Private local artifacts

- Original review corpus and early models: `/Users/adil/ponglens-data/active-ball`
- Original frozen Gemini runs: `/Users/adil/ponglens-data/active-ball/gemini-run1`, `gemini-run2`, `gemini-run3`, `gemini-run4`
- Cross-venue corpus and model: `/Users/adil/ponglens-data/active-ball-scale`
- Cross-venue Gemini run: `/Users/adil/ponglens-data/active-ball-scale/gemini-run2`
- YOLO dataset and checkpoint: `/Users/adil/ponglens-data/active-ball-scale/yolo-v1`
- Final YOLO teacher-test evaluation: `/Users/adil/ponglens-data/active-ball-scale/yolo-v1/final-evaluation`
- YOLO evaluation against the 178 human labels: `/Users/adil/ponglens-data/active-ball-scale/human-audit`

These paths contain private footage-derived media and raw model responses and must not be committed. Aggregate results, protocols, hashes and code belong in the repository. Before relying on a local artifact, verify that it exists and matches the recorded hash. Do not regenerate a missing artifact and silently give it the same name.

### Credentials

The Gemini key is stored in macOS Keychain under account `openclaw`, service `ponglens-gemini-api-key`. Read it without printing it. Never put it in a command line, log, response, source file or committed environment file. Authorization was granted to send the selected owner footage used in this experiment to Gemini. That authorization does not automatically cover a new external provider; record the provider and footage scope before uploading anything elsewhere.

## Work completed

### 1. Review interface and human corpus

The authenticated page at `https://www.ponglens.com/research/active-ball` contains 178 review samples and their private media. The user reviewed all 178. The frozen labels contain:

| State | Count |
| --- | ---: |
| Visible | 109 |
| Hidden | 24 |
| Absent | 45 |

Each sample has the source dimensions, target frame, adjacent frames, a 2.4-second half-speed context clip, selected-table corners and revision history. A visible label contains one source-pixel center. The other states contain no coordinates. Predictions are displayed separately and never overwrite human labels.

The labeling convention changed while the work was underway. The final intended rule counts a selected-table ball that is visibly held, resting on a paddle, being retrieved or being passed as `visible`, even outside a rally. The 178 labels were not all recollected after that clarification. State-agreement numbers therefore mix two conventions and must not be treated as clean ground truth for presence classification. The 109 visible center points remain useful localization references.

### 2. Early PongLens-owned models

Several local approaches were tested on the Mac Studio M1 Ultra through PyTorch MPS:

- A random-initialized three-frame heatmap model collapsed into background-dominated predictions.
- A native-resolution motion-patch classifier trained on 22 curated source frames sometimes found real balls but also selected shirt details and neighboring-table balls. Its 60-frame venue holdout had no independent human ground truth and cannot support an accuracy claim.
- A 96-pixel motion-patch scorer located 10 of 79 visible validation references within 20 pixels and made eight false visible predictions.
- A multiscale motion-and-appearance candidate scorer could not reliably rank the ball among hundreds of lookalikes.

These are recorded negative results. Do not use their training loss, their abstention count or a visually selected overlay as evidence of accuracy.

### 3. Frozen Gemini comparison

The final Gemini protocol used the exact model ID `gemini-3.8-flash`, three original-resolution stills, a 2.4-second context video, high media resolution, normalized 0..1000 table corners, temperature 0, low thinking, an 8,192-token output allowance and structured JSON. The model received no human labels, split names, venues, sample categories or prior predictions. Video was context only; coordinates referred to the target still.

Prompt 3 explicitly:

- counts a visibly held selected-table ball as visible;
- rejects balls on other tables, basket balls, floor balls, clothing, shoes, watches, reflections, court lines, table edges, net tape and logos;
- asks the model to use relevant players and temporal context to determine ball identity;
- tells the model that a line fragment revealed by a moving player is not ball motion;
- returns the center of the ball or the center of its blur.

The exact prompt is `scripts/research/gemini-active-ball-prompt3.txt`. The protocol is `/Users/adil/ponglens-data/active-ball/gemini-run4/protocol.json`. The benchmark file was frozen before inference with SHA-256 `62822f24273929e661ce2bdaf158d12a04cd71c0144cb1abe24824c02b35791d`.

| Measurement against the 178 frozen labels | Prompt 2 | Prompt 3 |
| --- | ---: | ---: |
| Visible reference within 10px | 58 / 109 | 88 / 109 |
| Visible reference within 20px | 67 / 109 | 100 / 109 |
| Visible reference within 40px | 75 / 109 | 102 / 109 |
| Visible reference missed | 22 / 109 | 6 / 109 |
| Visible prediction on hidden/absent reference | 7 / 69 | 21 / 69 |
| State agreement | 131 / 178 | 123 / 178 |
| Conditional median center error | 7.49px | 5.31px |
| Usable structured responses | 177 / 178 | 178 / 178 |
| Estimated list-price equivalent | $1.29 | $1.02 |

Prompt 3 was designed after inspecting earlier failures on the same corpus. It is an adjusted full-corpus comparison, not a sealed independent test. Its state results are further confounded by the changed held-ball convention. The localization improvement is still meaningful: among 87 frames where both prompts called the human-visible ball visible, Prompt 3 placed 84 within 20 pixels and Prompt 2 placed 67.

### 4. Cross-venue Gemini corpus

A second corpus contains 810 samples from nine additional recordings. Each recording contributes 72 frames sampled inside existing point intervals and 18 from gaps. Point intervals were used only for sampling distribution and were not sent to Gemini. The recordings are isolated by source hash across the fixed split:

| Split | Recordings | Samples |
| --- | --- | ---: |
| Train | `chris_b`, `chris_rc`, `julian_16`, `prabhas_rc`, `rowel` | 450 |
| Validation | `gavin_16`, `tripp_rc` | 180 |
| Test | `julian_rc`, `terry` | 180 |

The sources span LYTTC, PingPod, PingPod Dobro and Westchester TTC. The original Chris A, Ishan, Koko and Kumar sources were excluded because they appear in the 178-frame human benchmark. The corpus manifest SHA-256 is `0c35b65012796612f3dfb40e9ea6e1e2724b41d19f4c0b506a8f3aa51289a0ef`.

Gemini Prompt 3 returned 810 usable answers: 474 visible, 303 hidden, 21 absent and 12 unsure. Estimated list-price equivalent was $4.9619. The frozen protocol and raw answers are retained at `/Users/adil/ponglens-data/active-ball-scale/gemini-run2`.

### 5. Preliminary YOLO detector

A generic YOLO26n checkpoint was fine-tuned locally with Ultralytics 8.4.142. Each focused target frame was resized to a 1280-pixel model input. The selected table and nearby player region remained at full brightness while distant pixels were dimmed to 28 percent and the table polygon was drawn. Each Gemini visible center became a fixed 32-source-pixel square. Hidden and absent teacher labels became negative images. Twelve unsure examples were omitted.

Training used MPS, batch size 4, seed `20260905`, deterministic mode, up to 40 epochs and validation-only checkpoint selection. The confidence threshold of 0.20 was selected on the two validation recordings. The selected checkpoint is:

`/Users/adil/ponglens-data/active-ball-scale/yolo-v1/runs/finetune/weights/best.pt`

SHA-256: `c8073ea52d7626988bd69552a1eb72454166ff5dad8a553508703848525b8d30`

| Frozen evaluation | Visible within 20px | False visible on non-visible | Conditional median error |
| --- | ---: | ---: | ---: |
| Gemini-teacher test, Julian RC and Terry | 41 / 93 (44.1%) | 5 / 86 (5.8%) | 3.54px |
| Existing 178 human labels | 70 / 109 (64.2%) | 14 / 69 (20.3%) | 3.75px |
| Gemini Prompt 3 on those human labels | 100 / 109 (91.7%) | 21 / 69 (30.4%) | 5.31px |

The local model is usually well centered when it fires: 69 of its 70 successful human-reference localizations are within 10 pixels. Its main failure is recall: 36 visible references receive no detection and three receive a location over 20 pixels away. Westchester is weakest, with 8 of 17 visible references localized and 8 false visible predictions among 37 non-visible references. Median inference in the Python evaluation path was 27.2ms on the teacher test and 31.0ms on the human audit, excluding decoding and the rest of the production pipeline.

The published immutable run is `ponglens-yolo26n-20260905-v3`. No production worker, iOS processing path or released model changed.

## What the completed experiment does and does not prove

It proves that the project can build a deterministic corpus, use Gemini without exposing the references, preserve raw responses and protocol hashes, train on the Mac Studio, choose an operating point without reading test results, publish immutable comparisons, and produce a fast local detector that sometimes localizes accurately.

It does not establish any of the following:

- production accuracy;
- BlurBall equivalence;
- continuous tracking through a rally;
- correct identity when multiple tables or loose balls are visible;
- reliable distinction between hidden, outside-frame, absent and between-rally states;
- performance on 60 fps, variable-frame-rate, Android, moving-camera or broad user-uploaded footage;
- blur extent, direction or intra-frame motion;
- bounce, net contact, paddle contact or trajectory accuracy;
- a clean human test set for Prompt 3, because earlier prompt failures from the same corpus were inspected;
- the accuracy of the 810 Gemini labels, because their test split is a teacher-imitation test rather than human ground truth.

The existing 178-frame human audit has only three venues, contains isolated targets rather than dense sequences, and contains no blur-shape labels. It has been repeatedly viewed during development and must now be treated as a development audit. It must not be renamed a sealed final benchmark.

## Why the next labels must change

The current center click answers only “where is the middle?” A long motion-blurred ball can look like a line, arc or crescent. A fixed square centered on it makes the target mostly background and gives the model no supervision for the feature that distinguishes the ball from a shirt logo or floor marking.

BlurBall's published dataset illustrates the missing information. It contains 64,119 manually labeled frames from 26 fixed-camera recordings. Each visible ball was labeled by drawing a line along the blur, which yields the blur center, orientation and half-length. Sixty-two percent of its frames contain motion blur, with rare half-lengths up to 73 pixels. Its model uses multiple consecutive frames and a blur-shaped heatmap rather than a fixed box. Source: [BlurBall paper](https://arxiv.org/html/2509.18387).

PongLens should adopt the useful label convention while building a corpus for its own inputs, selected-table semantics, frame rates and failure modes. The goal is not to copy BlurBall's source, weights or dataset.

## Required label contract for the next corpus

The labeler should collect the smallest set of fields that directly trains or evaluates the desired system. The ball center should be derived from the blur endpoints rather than entered twice.

### Per-frame human label

```json
{
  "sample_id": "uuid",
  "source_frame_index": 12345,
  "presentation_time_s": 411.5003,
  "selected_table_id": "stable-within-recording",
  "ball_state": "visible | occluded | outside_frame | not_present | uncertain",
  "play_state": "rally | serve_setup | between_points | retrieval | uncertain",
  "blur": {
    "p1": [812.4, 414.8],
    "p2": [846.1, 421.3],
    "width_px": 7.0
  },
  "occlusion_reason": "player | paddle | table | net | frame_edge | unknown | null",
  "hard_negative": "shirt_logo | court_line | table_edge | net | reflection | shoe | watch | basket_ball | loose_ball | other_table_ball | background_light | other | null",
  "review_confidence": "certain | uncertain",
  "reviewer": "human | gemini_3_8_flash | qwen3_vl | propagated",
  "parent_label_id": "uuid-or-null"
}
```

Rules:

- `visible` means the selected-table ball itself is visible, including in a player's hand or on a paddle. `p1`, `p2` and width are required. For a sharp round ball, the endpoints may coincide at the center and width approximates its diameter.
- `occluded` means temporal context establishes that the selected-table ball is in the image area but hidden by something. No invented coordinate is allowed.
- `outside_frame` means temporal context establishes that the selected-table ball exists but is outside the target image.
- `not_present` means there is no ball associated with the selected interaction to locate. It must not be used merely because the rally is inactive.
- `uncertain` means a human cannot determine state or identity after using the provided context. It is excluded from ordinary supervised loss and retained for adjudication.
- Endpoint order is deliberately unsigned. Reversing `p1` and `p2` describes the same blur. Direction comes from adjacent frames and the track, not an arbitrary endpoint convention.
- `play_state` is independent of visibility. This removes the ambiguity that damaged the current hidden/absent comparison.
- `hard_negative` records the most tempting wrong object when one exists. It does not turn that object into the ball label.
- The canonical coordinates are source pixels. Normalized coordinates are derived only at model or API boundaries.

### Per-sequence human label

Dense clips also require:

- a stable selected table and the two relevant players;
- a stable ball-track identifier for the selected interaction;
- rally start and end boundaries;
- serve setup and serve contact when observable;
- paddle contacts, table bounces and net contacts when observable;
- explicit identity-break intervals where the track cannot be continued safely;
- camera cuts, camera motion and unusable spans;
- source FPS, presentation timestamp per decoded frame, dimensions, rotation, HDR/color conversion and duplicate-frame markers.

The first training iteration does not need every contact event to be hand-labeled. The minimum required fields are dense ball state, blur endpoints, play state, selected-table identity and hard-negative category. Contact and bounce annotations become necessary when evaluating trajectory reconstruction and point segmentation.

### Optional masks

Collect a pixel mask on a stratified subset of difficult visible frames, especially long blurs, balls overlapping lines and partial occlusions. Do not ask the user to draw masks on every frame. Use point/line labels to prompt SAM 3.1, then have a human accept or correct selected propagated masks. Masks test whether segmentation propagation is useful and provide supervision for a blur-extent head.

## Corpus design

The next corpus must be sequence-first. Random isolated frames should remain only as inexpensive hard negatives.

### Human gold development set

Build dense 2–6 second clips from at least 12 recordings across at least four venues, including:

- 30 fps and 60 fps sources;
- iPhone capture and website uploads;
- bright and dim lighting;
- white and orange balls when available;
- near and far camera positions;
- balls above, below, beside and behind the table;
- serves, rallies, held balls, retrieval and between-point activity;
- long blur, small sharp balls, line overlap and partial occlusion;
- dark shirts with white Butterfly, JOOLA and similar logos;
- neighboring tables in active play;
- baskets, floor balls and court markings.

Start with approximately 1,500 human-reviewed frames, selected by dense bursts and model disagreement rather than uniform random sampling. This is a development target, not a claim that 1,500 frames are sufficient for production. Prefer 150 difficult sequences over 1,500 unrelated easy stills.

### Sealed benchmark

Reserve entire recordings before prompt or model work. The initial sealed benchmark should contain at least:

- 6 recordings unseen by every teacher-prompt adjustment and local training run;
- 2 or more venues absent from training if footage allows;
- both 30 and 60 fps;
- at least 500 visible frames and 500 non-visible or decoy-heavy frames;
- dense rally sequences long enough to measure gaps and identity switches.

Adil may label this set, but the labels must remain unavailable to prompt writers and trainers until a candidate and operating point are frozen. After it is opened once, call it an evaluation result and create a new sealed benchmark for the next major iteration.

### Teacher corpus

After the label contract and teacher choice pass the pilot, generate 10,000–30,000 dense frame labels from owner-authorized recordings. General model output remains weak supervision with explicit provenance. Human review should concentrate on:

- teacher disagreements;
- long blur and low-resolution balls;
- state transitions;
- other-table activity;
- the current model's false positives and misses;
- new devices, venues, colors and camera positions.

Do not count augmentation, propagated frames or repeated crops as independent human labels. Split by original recording hash, and group near-duplicate exports from the same recording together.

## Next experiment: teacher and propagation bake-off

The immediate experiment should compare teacher and propagation choices before paying to label a large corpus.

### Frozen input set

Create a 400-sample development bake-off:

- 200 difficult visible frames, deliberately rich in blur, line overlap, occlusion and small balls;
- 100 non-visible frames with shirt logos, court lines, net tape, lights, shoes and reflections;
- 100 frames with other-table balls, held balls, loose balls, baskets and retrieval.

Sample these as dense short sequences across whole-recording splits. Human labels are frozen before model calls and are never included in model inputs. Because this is a development comparison, its results may select the teacher; it is not the final sealed benchmark.

### Candidates

1. **Gemini 3.8 Flash, low thinking.** Reproduce the current baseline exactly.
2. **Gemini 3.8 Flash, medium thinking.** This is Google's default and should be tested because the completed runs explicitly forced low thinking. Keep every other input and prompt field identical.
3. **Gemini 3.8 Flash, high thinking.** Run only after a 40-sample cost and quality pilot. Stop if it does not improve the error categories that require identity reasoning.
4. **Gemini 3.1 Pro or Google's current strongest image-capable model.** Resolve the exact model ID from the authenticated model catalog at run time, freeze it in the protocol, and run the same 40-sample pilot before the full bake-off.
5. **Qwen3-VL.** Test an API or locally feasible checkpoint with explicit point/box grounding and controllable image/video pixel budgets. Qwen's official repository advertises stronger 2D grounding, multi-image/video understanding and fine-detail processing, but it does not establish table-tennis blur superiority. Treat it as an independent challenger and potential adjudicator. Source: [Qwen3-VL repository](https://github.com/QwenLM/Qwen3-VL).
6. **SAM 3.1 seeded propagation.** Seed the selected ball from a correct human or teacher line/mask and propagate it forward and backward through the dense clip. SAM 3.1 detects, segments and tracks prompted objects; it does not by itself decide which identical ball belongs to the selected table. Source: [SAM 3.1 release](https://ai.meta.com/blog/segment-anything-model-3/) and [SAM 3 overview](https://ai.meta.com/research/sam3/).

Do not send only a normal Gemini video upload and assume every source frame was inspected. Google's default static video processing samples at 1 fps and warns that fast action can lose detail. Continue to provide explicitly decoded original-resolution frames at the temporal offsets being evaluated. Source: [Gemini video documentation](https://ai.google.dev/gemini-api/docs/video-understanding).

### Candidate output

Every teacher must return the same schema:

```json
{
  "ball_state": "visible | occluded | outside_frame | not_present | uncertain",
  "play_state": "rally | serve_setup | between_points | retrieval | uncertain",
  "p1": [0_to_1000, 0_to_1000],
  "p2": [0_to_1000, 0_to_1000],
  "width": 0_to_1000,
  "confidence": 0_to_1,
  "decoy_rejected": "enum-or-null",
  "reason": "short evidence statement"
}
```

The parser must reject invalid coordinates and invalid state/geometry combinations. It must not clamp, infer a different coordinate convention or retry with a changed prompt under the same run ID.

### Bake-off metrics

Report denominators and 95 percent bootstrap confidence intervals for:

- visible recall within 5, 10, 20 and 40 source pixels;
- false visible predictions per non-visible frame;
- selected-table violations;
- shirt-logo, line, net, reflection, basket and other-table false positives;
- blur endpoint error using the lower error of the two possible endpoint orders;
- blur midpoint error, orientation error modulo 180 degrees and length error;
- state and play-state confusion matrices;
- valid structured-response rate;
- cost per 1,000 target frames and elapsed time;
- performance by venue, frame rate, apparent ball size, blur length, play state and table-relative region.

Pick no winner from a single overall score. The teacher used for scale labeling must improve difficult visible recall without an unacceptable increase in selected-table false positives. If two teachers make different errors, retain both and send disagreements to human review rather than forcing one winner.

### Spending gate

Run 40 stratified samples for each new paid candidate first. Preserve raw responses and calculate actual token cost. Continue to all 400 only when the candidate either improves a priority metric or adds useful independent disagreements. Every runner must take `--max-usd`, stop before exceeding it and resume without replacing completed responses. Batch pricing may be used after the protocol is frozen. Record list-price estimates separately from invoices.

## PongLens model design after the bake-off

The next owned model should be a native-resolution temporal detector, not another ordinary one-frame box detector.

### Inputs

- 3–7 consecutive frames with their actual presentation-time deltas;
- a high-resolution selected-table/player region plus a lower-resolution whole frame;
- selected-table corner heatmaps or coordinate channels;
- optional player/paddle regions when available, without making pose a hard dependency;
- camera-motion features or registered frame differences;
- prior track state during continuous inference.

The selected-table context should be soft. The ball may legitimately be outside the table polygon or briefly outside the bright player region. A hard polygon crop would delete valid balls.

### Outputs

- a blur-shaped heatmap or mask for each target frame;
- ball center derived from the blur prediction;
- blur orientation and extent;
- presence/visibility state;
- play state in a separate temporal head;
- uncertainty calibrated for abstention;
- an embedding or association score used to continue the same ball track.

### Training losses

- heatmap or mask loss over the entire blur rather than a fixed box;
- midpoint and symmetric endpoint regression;
- visibility-state and play-state classification;
- hard-negative classification or contrastive loss for logos, lines and other-table balls;
- temporal consistency across adjacent frames using real timestamp deltas;
- association loss that rewards the selected ball and penalizes identity switches;
- confidence calibration on validation recordings.

Train and compare compact variants on MPS. Begin with a small HRNet/U-Net-style heatmap network with temporal channel attention because that architecture matches the geometry of a tiny blurred object. A transformer or DINO-style backbone is a later comparison if the compact model plateaus; it should not be the first expensive assumption.

### Sequence tracker

The frame model should emit multiple candidates when evidence is ambiguous. A separate tracker should select a path using:

- predicted confidence;
- displacement and acceleration limits expressed in time, not frames;
- table-plane and net-crossing context;
- player, paddle and contact proximity;
- blur orientation and length;
- appearance/association embedding;
- explicit gaps for occlusion or outside-frame states.

Do not fill every gap. The tracker must be able to say that identity is unknown. Confidence hysteresis should prevent one weak frame from starting or terminating a track.

## Evaluation and promotion gates

### Frame-level evaluation

Report center and blur metrics over every eligible frame. Retain misses in the denominator. Report false selections by category and location. In addition to source-pixel thresholds, normalize midpoint error by source dimensions or table diagonal so 720p, 1080p and 4K results can be compared fairly.

### Sequence-level evaluation

Report:

- percentage of human-visible rally frames tracked;
- precision over all emitted track points;
- identity switches and selected-table violations per rally;
- gap count and longest gap during visible motion;
- longest continuously correct portion of each rally;
- correct recovery after occlusion;
- endpoint/contact/bounce timing error in milliseconds when those labels exist;
- end-to-end processing time for 30 and 60 fps footage, including decoding and tracking.

### Required comparisons

Run the frozen candidate against:

- Gemini teacher predictions;
- the September 5 YOLO model;
- the existing released BlurBall path on the same authorized benchmark, without copying or redistributing BlurBall artifacts;
- simple motion/trajectory baselines.

“Better than BlurBall” means better on the sealed PongLens benchmark in the product-relevant metrics: visible-rally coverage, selected-table precision, identity continuity and hard-case performance. It does not mean a higher score on BlurBall's own dataset or a visually better handful of frames.

### Promotion conditions

Before any production replacement, all of the following must be true:

1. The model and operating point were frozen before opening the sealed test labels.
2. It beats the released baseline on the primary sequence metrics and has no material regression at any named venue, frame-rate or decoy category.
3. It has been shadow-run on complete owner matches and reviewed on the research page without changing customer-visible results.
4. Failures abstain or fall back safely; uncertain tracks do not become invented bounces or point boundaries.
5. One immutable release contains code, weights, dependencies, thresholds, preprocessing, output contract and checksums.
6. The same release passes parity fixtures on the Mac Studio and Modal worker before cloud dispatch is enabled.
7. The full worker tests and full `npm run build` pass. Desktop web, 393x660 mobile web and native iOS are checked separately if any surface changes.

## Execution order for the next agent

1. Read `CLAUDE.md` and the canonical records listed above.
2. Verify the current branch, worktree and local artifact hashes. Record missing artifacts; do not silently recreate them.
3. Create a machine-readable experiment ledger containing source hashes, split, label provenance, prompt/model/config hash, code commit, cost and artifact hashes.
4. Extend the label schema and research UI for blur endpoints, separate ball/play states, hard-negative categories and dense sequence navigation. Preserve the existing 178 labels as legacy version 1 data.
5. Build and human-review a small dense pilot across 30 and 60 fps footage. Measure inter-reviewer repeatability on at least 50 duplicated difficult frames before scaling.
6. Freeze the 400-sample teacher bake-off and its human references.
7. Run the 40-sample spending gates, then complete only the candidates that justify the cost.
8. Test SAM 3.1 propagation from correct seeds and from teacher seeds separately. This separates tracking quality from seed quality.
9. Choose the teacher/consensus policy on the 400-sample development set and record the decision before building the large teacher corpus.
10. Build the dense 10,000–30,000-frame weak corpus with explicit provenance. Route disagreements and hard cases to human review.
11. Train the compact temporal blur model on the Mac Studio. Select architecture, checkpoint and operating point using recording-isolated validation only.
12. Freeze the candidate and open the sealed benchmark once.
13. If it misses a promotion gate, add failures to the next development set, create a new sealed benchmark and repeat. Never tune against the opened sealed set.
14. Only after the gates pass, write a separate production integration specification covering worker packaging, parity, shadow mode, rollback and monitoring.

## Reproduction commands for completed work

Use `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python` from the release worktree.

```sh
# Export current reviewed labels without printing credentials.
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m worker.export_active_ball_labels \
  /Users/adil/ponglens-data/active-ball/review-manifest.json

# Re-run the frozen Prompt 3 human comparison. Completed responses are skipped.
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  scripts/research/gemini-active-ball-v4.py \
  /Users/adil/ponglens-data/active-ball/gemini-run4 \
  --interval 0 --max-usd 3

# Re-run the cross-venue Prompt 3 teacher. Completed responses are skipped.
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  scripts/research/gemini-active-ball-scale.py \
  /Users/adil/ponglens-data/active-ball-scale/gemini-run2 \
  --interval 0 --max-usd 10

# Recreate the YOLO training dataset from the frozen teacher manifest.
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  scripts/research/build-active-ball-yolo-dataset.py \
  /Users/adil/ponglens-data/active-ball-scale/gemini-run2/teacher-manifest.json \
  /Users/adil/ponglens-data/active-ball-scale/yolo-v1
```

Do not re-run paid calls merely to prove reproducibility when all response files are present. Verify hashes and run parsers/evaluators first.

## Relevant verification already completed

For the September 5 release branch, the recorded checks include:

- 28 active-ball Python tests for the Gemini comparison stage;
- 6 TypeScript ball/comparison/coordinate tests;
- 25 Python dataset/model/motion/training/prediction tests for the earlier patch-model delivery;
- authenticated read-only desktop QA at 1440x1000;
- authenticated mobile QA at 393x660;
- full `npm run build` after the active-ball changes;
- immutable publication checks proving all 178 human labels and revisions remained unchanged;
- RLS checks denying anonymous access and ordinary-user access to the research data.

These are historical verification claims recorded in the September 5 documents. A continuation agent must run the checks appropriate to its own changes and report exactly what it did and did not verify.

## Research basis and current external candidates

- Google lists `gemini-3.8-flash` as its current generally available Flash model, with low, medium and high thinking levels. The completed PongLens experiment used low. Source: [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/latest-model).
- Gemini supports image inputs and structured outputs, but ordinary static video ingestion samples at 1 fps and may lose detail in fast action. Explicit adjacent source frames remain necessary. Source: [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding).
- Qwen3-VL offers point and box grounding, configurable visual pixel budgets, multi-image/video inputs and fine-tuning support. Its published general grounding claims do not prove fast-ball accuracy; it belongs in the bake-off. Source: [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL).
- SAM 3/3.1 accepts text, exemplar, point, box or mask prompts and tracks masks through video. It is most relevant for propagation after a seed is known. Source: [SAM 3](https://ai.meta.com/research/sam3/) and [SAM 3.1](https://ai.meta.com/blog/segment-anything-model-3/).
- BlurBall provides the closest published task-specific evidence. Its 64,119-frame corpus labels blur center, orientation and length, and its detector uses multi-frame blur-shaped heatmaps. Source: [BlurBall](https://arxiv.org/html/2509.18387).

No reviewed source found during the September 5–6 search demonstrates that a Chinese or other general vision-language model already outperforms Gemini on tiny motion-blurred table-tennis ball localization. That remains an empirical question for the frozen PongLens bake-off.

## Audit checklist

An independent reviewer should challenge this document and the experiment on the following points:

- Are the source recordings and near-duplicate exports isolated across train, validation and test by content hash rather than filename?
- Were any human labels, prior predictions, split names or error analyses included in a teacher input?
- Does every published number preserve misses and invalid answers in its denominator?
- Were prompts or state definitions changed after any part of the same evaluation corpus was inspected?
- Are legacy state labels being compared as though the held-ball convention had always been the same?
- Is the local model evaluated against human truth or only against its Gemini teacher?
- Do fixed boxes or resized images erase the blur signal the model is expected to learn?
- Are other-table balls represented as explicit hard negatives and sequence identity failures?
- Does the test set cover 30 fps, 60 fps, device uploads, website uploads, venues, ball colors, lighting and camera distance?
- Are thresholds and checkpoints selected before test labels are opened?
- Are raw responses, model versions, configs, dependency versions, source commits and artifact hashes retained?
- Can the Mac Studio reproduce training and inference without an undisclosed cloud dependency?
- Can the final immutable pipeline run equivalently on Mac MPS and Modal CUDA?
- Does production shadowing measure full-match identity continuity rather than isolated attractive examples?
- Is any claim of “better than BlurBall” tied to a named sealed benchmark and product-level metrics?

Every audit finding should be added below as a dated amendment. Do not rewrite historical results to make later work look cleaner.

## Amendment log

- **2026-09-06:** Initial handoff assembled from the committed September 5 research code, aggregate results, frozen local protocols and current primary-source model documentation.
