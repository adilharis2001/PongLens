# Gemini active-ball comparison

User authorized sending the selected footage to Gemini, then supplied a Keychain key. Account `openclaw`, service `ponglens-gemini-api-key`. Never print it. Models endpoint authenticated successfully and listed `gemini-3.8-flash`; that exact model is used.

## Frozen experiment

Local root: `/Users/adil/ponglens-data/active-ball/gemini-run1`.

- `benchmark.json`: all178 user labels exported before inference (109 visible,24 hidden,45 absent). SHA256 `62822f24273929e661ce2bdaf158d12a04cd71c0144cb1abe24824c02b35791d`.
- `inputs.json`: allow-listed media paths, image dimensions, times, table corners and sample ids. No labels, provisional labels or local predictions. Runner reads only this file.
- `protocol.json`: frozen prompt, exact model/config, inputs hash, predeclared10/20/40 source-pixel tolerances. Three original JPEGs plus2.4s video context, high media resolution, LOW thinking, temperature0,2048 output-token limit. Video is context; requested coordinates refer only to TARGET still.
- `responses/`: immutable raw response, parsed source-pixel prediction, elapsed time and token-price equivalent. No prompt was tuned after seeing answers. Original labels are never changed by the runner/publisher.
- `summary.json`: explicitly PARTIAL.12 answers, all LYTTC; only2 human-visible examples so far. Not enough to draw conclusions. Nine visibility states agree; one of the two visible balls is within20px; two false visible detections among10 human-hidden/absent examples. Do not call9/12 detector accuracy.

## Current external limit

The API reported both5 free-tier requests/minute and20/day.503 demand errors also occurred. Twelve usable results were returned. API calls are now STOPPED awaiting user billing activation or quota reset. Do not silently change models, keys or projects to avoid the limit. No automation was created. User was asked asynchronously to enable billing or choose a multi-day free-tier run.

Completed responses have about$0.058 of list-price-equivalent tokens, not an invoice: requests used the free tier. Published standard rates checked September5: input$0.75/M, output including thinking$3.75/M until December31. Entire178 estimated around$1 from this small sample. Runner default budget guard$5. HTTP daily-quota errors now stop immediately, even if Google supplies a misleading short RetryInfo. Per-minute retries respect its delay and requests are paced13s apart.

## Resume

From the release worktree, interpreter `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`:

```sh
python scripts/research/gemini-active-ball.py /Users/adil/ponglens-data/active-ball/gemini-run1
python scripts/research/publish-active-ball-evaluation.py /Users/adil/ponglens-data/active-ball/gemini-run1
```

The runner skips completed responses. Keep protocol and benchmark byte-identical. Publisher validates registered SHA256 fingerprints and existing immutable results; a mismatch aborts the transaction. Null/invalid completed predictions remain in evaluation denominators. API failures without a generated response remain unprocessed. `worker/active_ball_benchmark.py` scores with misses retained in visible-reference denominators.

## Research page

Migrations `20260905220000_active_ball_evaluations.sql` and `20260905223000_active_ball_evaluation_protocols.sql` are applied and registered. Both tables have RLS, admin-only authenticated SELECT, no anon/authenticated writes.12 evaluations are stored alongside frozen reference labels/revisions. Local model predictions and all178 human labels remain unchanged.

The page gains Gemini comparison and Edit labels modes; default comparison filters disagreements (>20px or a different visibility state). It shows the evaluated denominator explicitly, uses frozen cyan reference marks and pink Gemini predictions, and prevents saving/editing in comparison mode. Partial runs never claim full completion. All original labeling controls remain in Edit labels.

Independent review found and verified fixes for dropping invalid responses and mixing protocol versions. Three Python scoring and three TypeScript comparison cases verify denominators/location errors/missing results. Full28 Python active-ball tests and12 combined TypeScript review/catalog/comparison tests are the relevant suite. Browser QA `scripts/qa/active-ball-comparison.mjs` is read-only; it exercises navigation, disabled editing, separate label mode and1440×1000/393×660 layout. Build log is in the local artifact root.

Sources: https://ai.google.dev/gemini-api/docs/pricing , https://ai.google.dev/gemini-api/docs/generate-content/structured-output , https://ai.google.dev/gemini-api/docs/billing .

## Billing enabled and revised prompt

Adil enabled billing and requested a prompt adjustment after spotting a white court-line fragment mistaken for the ball. Prompt 2 explicitly checks background-relative motion and line continuity, including short line fragments exposed by moving players. It distinguishes occluder motion from ball motion, without automatically rejecting motion blur, a ball overlapping a line, or small displacement between adjacent frames.

`gemini-active-ball-v2.py` preserves the original runner and appends those instructions. Its separate format pilot (`gemini-run2`) was stopped at 47 responses after two answers were truncated at the shared 2,048-token reasoning/output cap. The final run uses `gemini-active-ball-v3.py`: exactly the same Prompt 2 with an 8,192-token allowance, otherwise unchanged model, media and generation settings. Paid request pacing is explicitly supplied with `--interval 0`; the original runner keeps its 13-second default for reproducibility. Four disjoint shards share a $4.50 estimated-cost guard, leaving room for the pilots inside the previously stated $5 estimate ceiling.

All 178 frozen references are rerun in `/Users/adil/ponglens-data/active-ball/gemini-run3`, published under `gemini-3.8-flash-20260905-v3`. The page identifies the instructions as Prompt 2. Original responses and pilot responses remain separate. Unusable answers remain scored failures; the runner can resume past them without retrying or replacing them.

The prompt adjustment uses feedback from run 1, so this is an adjusted experiment, not an untouched test corpus. `summarize-active-ball-evaluation.py` reports the 12 examples already evaluated in run 1 separately from the other 166, as well as per-venue results. The latter still share matches and potentially nearby moments with the inspected examples. No individual reference label is sent to Gemini.

Resume and publish this revision:

```sh
python scripts/research/gemini-active-ball-v3.py /Users/adil/ponglens-data/active-ball/gemini-run3 --interval 0 --max-usd 4.5
python scripts/research/publish-active-ball-evaluation.py /Users/adil/ponglens-data/active-ball/gemini-run3 --run-id gemini-3.8-flash-20260905-v3
python scripts/research/summarize-active-ball-evaluation.py /Users/adil/ponglens-data/active-ball/gemini-run3 --prior-run /Users/adil/ponglens-data/active-ball/gemini-run1
```

### Completed Prompt 2 results

All 178 attempted; 177 usable structured answers. One answer returned x=1300 despite the requested 0..1000 scale and is retained as an unanswered failure, without clamping or guessing a different coordinate convention.

- Visible-ball localization: 58/109 within 10 source pixels, 67/109 within 20 pixels (61.5%), 75/109 within 40 pixels.
- State agreement: 131/178 (73.6%).
- False visible detections: 7/69 human hidden/absent frames, all at Westchester.
- 22/109 visible reference balls were missed or unanswered; another 20 were called visible but placed more than 20 pixels away.
- Per venue, within 20px: LYTTC 26/46, PingPod 35/46, Westchester TTC 6/17.
- Previously inspected 12: false visible detections fell from 2 to 0, while state agreement moved from 9/12 to 10/12. Two hidden frames are now called absent, so eliminating the dot is not a fully correct interpretation. This small inspected subset cannot establish a general gain.
- Other 166: 66/107 visible balls within 20px; 121/166 state agreement; seven false detections. They remain related footage, not a new independent holdout.
- Estimated list-price equivalent: $1.2944 for the complete final run; $1.6224 including the original 12 and 47-response format pilot. These are token-based estimates, not invoice totals.

Full aggregate output is in `prompt2-summary.json`. Raw responses and the frozen protocol remain in the local run directory. All runs preserve the same benchmark SHA-256 `62822f24273929e661ce2bdaf158d12a04cd71c0144cb1abe24824c02b35791d`.

Verification: full `npm run build` passed after incorporating current main. All 28 active-ball Python tests and six TypeScript ball/comparison tests passed; a synthetic incomplete-run check verified invalid-answer denominators and false detections. Authenticated desktop (1440×1000) and mobile (393×660) browser checks passed for read-only comparison, next disagreement, no horizontal overflow and separate label editing. Publication asserts every existing immutable result and verifies human labels/revisions are unchanged within the transaction. No production worker or iOS change.

## Prompt 3: consistent coordinates and visible held balls

After the coordinate and presence diagnostics, Adil approved a full 178-example run with the tested corrections. Run 4 uses exactly the held-ball diagnostic's prompt and configuration: all geometry and answers use normalized 0..1000 coordinates, original image dimensions are omitted from the prompt, and a visibly held ball counts as visible. Media, model (`gemini-3.8-flash`), 8192-token allowance and generation settings are unchanged. The inputs contain no labels. The expanded visibility definition is shown on the comparison and label-editing pages, including the hidden/absent choices.

The runner defaults to the old pixel context so old experiment fingerprints and resumability are preserved. Only normalized mode adds `coordinate_context` to the frozen protocol. The v4 wrapper loads the exact tested prompt from `gemini-active-ball-prompt3.txt`. The new run is `/Users/adil/ponglens-data/active-ball/gemini-run4`, database ID `gemini-3.8-flash-20260905-v4`, with a $3 estimated-cost stop. All original human labels remain frozen, including known presence-definition disagreements; no labels are repaired automatically. Prior run results stay immutable.

This is an adjusted full-corpus comparison following error analysis, not an independent unseen benchmark. Do not present changed state agreement as a like-for-like measure of the old active-rally task. Visible-ball center localization remains measured against the same 109 visible reference positions; newly visible predictions on hidden/absent references remain disagreements.

```sh
python scripts/research/gemini-active-ball-v4.py /Users/adil/ponglens-data/active-ball/gemini-run4 --interval 0 --max-usd 3
python scripts/research/publish-active-ball-evaluation.py /Users/adil/ponglens-data/active-ball/gemini-run4 --run-id gemini-3.8-flash-20260905-v4
python scripts/research/summarize-active-ball-evaluation.py /Users/adil/ponglens-data/active-ball/gemini-run4 --prior-run /Users/adil/ponglens-data/active-ball/gemini-run3
```
