# Audio impact labeling: recent cross-venue v1

This study builds human truth for short table-tennis sounds and evaluates an
offline classifier. It does **not** alter point detection, serve detection,
placement, or any other production inference. A successful model must enter
shadow mode before it can support visual evidence.

The protected desktop reviewer is:

- Production: <https://www.ponglens.com/research/audio-impacts>
- Local: <http://localhost:3000/research/audio-impacts>
- Batch slug: `audio-impact-labeling-recent-v1`

The nine stored answers are paddle, table, floor, shoe/stomp, net, background
court, other, no clear impact, and unsure. `unsure` completes a review answer
but is excluded from training and evaluation.

## Prerequisites

- Run commands from the PongLens repository root.
- Use Python 3.12 with NumPy, SciPy, boto3, requests, psycopg2, and ffmpeg.
  The checked local environment is
  `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`.
- Production access comes from the existing `ponglens-*` macOS Keychain items,
  or the equivalent `SUPABASE_*`, `DATABASE_URL`, and `R2_*` environment
  variables used by `worker/build_research_pilot.py`.
- Only an admin account can open the page, sign media, or export the batch.

For the commands below:

```bash
AUDIO_PYTHON=/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python
AUDIO_RUN=artifacts/audio-impact-labeling-recent-v1
mkdir -p "$AUDIO_RUN"
```

`artifacts/` is operator output. Do not commit label exports, source media,
model artifacts, or reports containing research identifiers.

## Build, audit, and seed Round A

The default builder is read-only. It chooses nine distinct recent recordings:
three each from PingPod, Westchester, and LYTTC. The initial manifest freezes
30 timeline-stratified Round A points, 30 sealed Round C points, and the entire
eligible Round B pool. Round B's final 30 points do not exist yet.

```bash
"$AUDIO_PYTHON" worker/build_audio_impact_research.py \
  --manifest-out "$AUDIO_RUN/cohort-initial.json" \
  --audit-out "$AUDIO_RUN/cohort-initial.audit.json"
```

This also downloads every selected A/C point and every eligible B-pool point
without writing production state. It verifies video/audio decode, duration,
sample rate, detector output, exact media SHA-256, and cross-recording content
identity. Check for 60 initially selected points, 9 recordings, 30 A, 30 C,
and a non-empty B pool. Re-run with `--inventory-only` and confirm the manifest
SHA-256 is unchanged before writing anything.

Apply only the page's media-namespace migration, using the frozen manifest:

```bash
"$AUDIO_PYTHON" worker/build_audio_impact_research.py \
  --manifest "$AUDIO_RUN/cohort-initial.json" \
  --apply-migration
```

Seed the research batch and immutable R2 clips. This is the explicit write
step; it does not modify production matches or points:

```bash
"$AUDIO_PYTHON" worker/build_audio_impact_research.py \
  --manifest "$AUDIO_RUN/cohort-initial.json" \
  --audit "$AUDIO_RUN/cohort-initial.audit.json" \
  --seed
```

The seed is idempotent for the same cohort hash. It fails closed if existing
rows belong to another manifest. Round C is already frozen in storage, but the
page, media signer, and export API expose only Round A at this phase.

## Labeling QA

Use a desktop browser and headphones when possible. Review the natural-speed
loop first; 0.5x and 0.25x are confirmation tools. Use `Add missed sound` when
an audible impact lacks a marker, and `No clear impact` when a marker is not a
meaningful sound. Use `Unsure` instead of guessing.

During the first checkpoint:

- Finish every Round A assignment.
- Spot-check at least one completed point from each of the nine recordings
  using full-point context, and at least five completed points per venue.
- Confirm paddle/table distinctions in both quiet PingPod and the noisier
  Westchester/LYTTC recordings.
- Confirm shoe/stomp is used for foot impact, not general club noise.
- Confirm every completed point has an explicit answer for every marker.

## Select and label adaptive Round B

After A is complete, click `Export batch` and save the phase-scoped download as
`$AUDIO_RUN/round-a-export.json`. Train the same bound linear pipeline used by
the final baseline; this checkpoint model is used only for acquisition:

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py fetch-media \
  --export "$AUDIO_RUN/round-a-export.json" \
  --media-dir "$AUDIO_RUN/media"

"$AUDIO_PYTHON" worker/train_audio_impacts.py train-linear \
  --export "$AUDIO_RUN/round-a-export.json" \
  --media-dir "$AUDIO_RUN/media" \
  --artifact-out "$AUDIO_RUN/round-a-model.json" \
  --report-out "$AUDIO_RUN/round-a-report.json"

"$AUDIO_PYTHON" worker/train_audio_impacts.py fetch-pool-media \
  --manifest "$AUDIO_RUN/cohort-initial.json" \
  --audit "$AUDIO_RUN/cohort-initial.audit.json" \
  --media-dir "$AUDIO_RUN/pool-media"

"$AUDIO_PYTHON" worker/train_audio_impacts.py score-pool \
  --manifest "$AUDIO_RUN/cohort-initial.json" \
  --audit "$AUDIO_RUN/cohort-initial.audit.json" \
  --artifact "$AUDIO_RUN/round-a-model.json" \
  --media-dir "$AUDIO_RUN/pool-media" \
  --scores-out "$AUDIO_RUN/round-b-scores.json"
```

Use `model_sha256` from `round-a-model.json` to finalize and seed Round B:

```bash
"$AUDIO_PYTHON" worker/build_audio_impact_research.py \
  --manifest "$AUDIO_RUN/cohort-initial.json" \
  --round-b-scores "$AUDIO_RUN/round-b-scores.json" \
  --round-b-model-sha '<model_sha256>' \
  --manifest-out "$AUDIO_RUN/cohort-final.json" \
  --audit "$AUDIO_RUN/cohort-initial.audit.json" \
  --seed
```

The complete pool was frozen and audited before A. Selection combines model
uncertainty with low-band confound novelty and deterministic tie breaks, then
persists every score component and the acquisition model hash. The database
requires all A rows to be submitted before it admits B. The page now exposes
A and B, while C remains unavailable.

## Train the required linear baseline

After B is complete, export again to `$AUDIO_RUN/development-export.json` and
fetch its immutable media. The trainer filters the export again: only completed
A/B human labels are development examples; `unsure` and all C rows are excluded.

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py fetch-media \
  --export "$AUDIO_RUN/development-export.json" \
  --media-dir "$AUDIO_RUN/media"
```

The baseline command decodes mono audio, extracts a fixed 200 ms window centered on
each event, resamples reproducibly to 48 kHz (9,600 samples), and computes
short-time full-band spectral features. Validation folds are grouped by source
recording. The class-weighted regularized linear model and abstention threshold
are selected using A/B only.

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py train-linear \
  --export "$AUDIO_RUN/development-export.json" \
  --media-dir "$AUDIO_RUN/media" \
  --artifact-out "$AUDIO_RUN/linear-model.json" \
  --report-out "$AUDIO_RUN/development-report.json"
```

The artifact freezes training event/source/recording IDs, a training-data
hash, model hash, and threshold hash. Keep that exact artifact unchanged.

The optional CNN experiment is not required for the baseline. Its dependency
check is explicit:

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py check-cnn
```

If PyTorch is absent, the command prints the exact install instruction; the
linear path remains fully usable. If installed, run the comparison with the
same grouped folds and frozen media:

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py train-cnn \
  --export "$AUDIO_RUN/development-export.json" \
  --media-dir "$AUDIO_RUN/media" \
  --linear-report "$AUDIO_RUN/development-report.json" \
  --report-out "$AUDIO_RUN/cnn-report.json"
```

The CNN is accepted only for at least +0.03 selective macro F1 with no venue's
selective accuracy declining by more than 0.02. Otherwise the linear model is
the frozen result.

## One-time sealed scoring

Only after feature choices, model, and abstention threshold are frozen may the
database unlock Round C. This transition binds the exact A/B export, cohort,
detector, feature, split, training-data, model, and threshold hashes:

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py unlock-sealed \
  --export "$AUDIO_RUN/development-export.json" \
  --artifact "$AUDIO_RUN/linear-model.json" \
  --apply
```

Label Round C with predictions hidden, export to
`$AUDIO_RUN/sealed-export.json`, fetch any new media, then score exactly once:

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py fetch-media \
  --export "$AUDIO_RUN/sealed-export.json" \
  --media-dir "$AUDIO_RUN/media"

"$AUDIO_PYTHON" worker/train_audio_impacts.py score-sealed \
  --export "$AUDIO_RUN/sealed-export.json" \
  --media-dir "$AUDIO_RUN/media" \
  --artifact "$AUDIO_RUN/linear-model.json" \
  --report-out "$AUDIO_RUN/sealed-report.json" \
  --record-score
```

The scorer refuses non-C evaluation rows, missing frozen hashes, altered model
or threshold contents, and any overlap between training and sealed source IDs.
The database records the report hash and rejects a second scoring transition.

## Reading the report

Reports include confusion matrices; precision, recall, F1, and counts for all
eight trainable classes; macro F1; paddle/table balanced accuracy and ROC AUC;
abstention coverage; and separate recording and venue summaries. Classes with
fewer than 30 A/B examples or 15 C examples are marked `data_insufficient`
without being merged.

Research gates:

- At or below 0.60 sealed paddle/table balanced accuracy: stop or redesign.
- Above 0.60 but materially venue-dependent: continue research only.
- Consider shadow mode only at 0.80 or better balanced accuracy with at least
  70% coverage in every supported venue, and only if false audio impacts do not
  degrade the downstream visual benchmark.
- Floor, shoe/stomp, net, and background remain rejection/confound labels until
  each independently clears the same per-venue gate with sufficient data.

No Round C result may be used to revise this batch's features, classes,
threshold, or model. Any revision starts a newly versioned, newly sealed batch.
