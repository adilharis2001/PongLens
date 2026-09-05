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
