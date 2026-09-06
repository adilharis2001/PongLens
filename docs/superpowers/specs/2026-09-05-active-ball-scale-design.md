# Active-ball scale experiment design

## Goal

Use Gemini 3.8 Flash Prompt 3 to label a larger, diverse corpus from nine additional owner matches, train a small PongLens-owned detector on the Mac Studio, and measure it on whole matches excluded from training.

## Corpus

Create 810 examples, 90 from each of nine source recordings that are absent from the existing human benchmark. Each example contains the target frame, the adjacent decoded frames, a 2.4-second context clip, original source timestamps, and the selected table's canonical corners. Sample 72 targets from inside existing point intervals and 18 from gaps between points. Keep targets at least 1.2 seconds from the recording edges and at least 0.35 seconds apart.

The split is fixed by whole recording:

| Split | Sources | Venue |
| --- | --- | --- |
| Train | chris_b, chris_rc, julian_16, prabhas_rc, rowel | PingPod, PingPod Dobro, LYTTC |
| Validation | gavin_16, tripp_rc | LYTTC, Westchester TTC |
| Test | julian_rc, terry | PingPod, Westchester TTC |

Record the full source SHA-256 so duplicate recordings cannot cross splits. The existing Ishan duplicate is excluded. Chris A, Koko and Kumar are also excluded because they occur in the original 178 reviewed examples; those examples remain a separate human-reference audit and do not select the new test checkpoint.

## Labels

Use the exact Prompt 3 contract already tested on all 178 examples. All table geometry and returned locations use normalized 0..1000 coordinates. A visible held ball belonging to the selected table counts as visible. Balls on other tables, loose floor balls, baskets, clothing, reflections and lines do not. Gemini never receives reference labels or prior model predictions.

Convert usable responses to manifest labels with provenance `gemini_3_8_flash_prompt3`. Retain raw responses, protocol fingerprint, source manifest and cost estimate. Invalid responses remain unusable; they are never guessed or silently retried with a changed prompt.

## Model

Fine-tune the generic pretrained YOLO26 nano detector for one `active_ball` class at 1280-pixel input resolution. Convert each visible teacher center to a fixed 32-source-pixel training box; hidden and absent frames are true negative images. Before training and inference, keep the selected table and its surrounding player region at full brightness, dim distant image regions, and draw the supplied table polygon. This conditions the detector on the selected table without sending labels or test information into preprocessing.

The earlier local motion/appearance candidate scorers remain documented negative results: their 96-pixel and multiscale candidate crops could not rank the active ball reliably among hundreds of lookalikes on validation recordings. They are not promoted as the preliminary model.

Select the checkpoint and confidence threshold only on the two validation matches. Freeze them before opening test metrics. Report test results by match and venue: final localization within 10/20/40 pixels over every visible reference, visible misses, false visible selections, median conditional center error, and model inference time.

## Interpretation and boundaries

This test measures imitation of Prompt 3 labels on unseen recordings. It is preliminary evidence for an owned detector, not equivalence to BlurBall and not human-verified production accuracy. The original 178 human labels provide a secondary audit after the test threshold is frozen. Continuous-rally identity switches require a later dense playback evaluation.

Everything runs on the Mac Studio with PyTorch MPS where available. No production worker, iOS app, Modal worker, or released model changes. Outputs live under `/Users/adil/ponglens-data/active-ball-scale`; only reproducible scripts, aggregate results and documentation enter the repository.

## Verification

Unit tests cover deterministic sampling, recording-level split isolation, Prompt 3 label conversion, proposal-label assignment, threshold selection and denominator-preserving scoring. Verify source/frame dimensions and timestamps during extraction. Before reporting completion, run all active-ball Python tests, the research TypeScript tests, and the full Next build. Independently review the implementation and results before merging.
