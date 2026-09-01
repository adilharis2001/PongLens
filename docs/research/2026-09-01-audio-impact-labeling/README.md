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

## Build and seed the frozen cohort

The default builder is read-only. It chooses nine distinct recent recordings:
three each from PingPod, Westchester, and LYTTC, with ten points per recording
and 30 points in each of rounds A, B, and C.

```bash
"$AUDIO_PYTHON" worker/build_audio_impact_research.py \
  --manifest-out "$AUDIO_RUN/cohort.json"
```

Check that the summary is exactly 90 points, 9 recordings, 30 per venue, and
30 per round. Re-run the same command and confirm the manifest SHA-256 is
unchanged before writing anything.

Apply only the page's media-namespace migration, using the frozen manifest:

```bash
"$AUDIO_PYTHON" worker/build_audio_impact_research.py \
  --manifest "$AUDIO_RUN/cohort.json" \
  --apply-migration
```

Seed the research batch and immutable R2 clips. This is the explicit write
step; it does not modify production matches or points:

```bash
"$AUDIO_PYTHON" worker/build_audio_impact_research.py \
  --manifest "$AUDIO_RUN/cohort.json" \
  --seed
```

The seed is idempotent for the same cohort hash. It fails closed if existing
rows belong to another manifest.

## Labeling QA

Use a desktop browser and headphones when possible. Review the natural-speed
loop first; 0.5x and 0.25x are confirmation tools. Use `Add missed sound` when
an audible impact lacks a marker, and `No clear impact` when a marker is not a
meaningful sound. Use `Unsure` instead of guessing.

Before model training:

- Finish Round A, then Round B.
- Keep Round C operationally sealed: do not inspect its aggregate labels,
  train on it, tune a threshold on it, or use it for acquisition decisions.
- Spot-check at least five completed points per venue using full-point context.
- Confirm paddle/table distinctions in both quiet PingPod and the noisier
  Westchester/LYTTC recordings.
- Confirm shoe/stomp is used for foot impact, not general club noise.
- Confirm every completed point has an explicit answer for every marker.

## Export and materialize training media

After A and B are complete, open the protected page and click `Export batch`.
Save the download as:

```text
artifacts/audio-impact-labeling-recent-v1/export.json
```

The trainer filters the export again: only completed, submitted human labels
from A/B are development examples; `unsure` and all Round C rows are excluded.
Download the immutable source clips named by that export:

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py fetch-media \
  --export "$AUDIO_RUN/export.json" \
  --media-dir "$AUDIO_RUN/media"
```

## Train the required linear baseline

This command decodes mono audio, extracts a fixed 200 ms window centered on
each event, resamples reproducibly to 48 kHz (9,600 samples), and computes
short-time full-band spectral features. Validation folds are grouped by source
recording. The class-weighted regularized linear model and abstention threshold
are selected using A/B only.

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py train-linear \
  --export "$AUDIO_RUN/export.json" \
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
linear path remains fully usable.

## One-time sealed scoring

Only after feature choices, model, and abstention threshold are frozen should
Round C be labeled and the batch exported again. Preserve the earlier A/B
export and model artifact. Fetch any newly referenced clips, then run:

```bash
"$AUDIO_PYTHON" worker/train_audio_impacts.py fetch-media \
  --export "$AUDIO_RUN/sealed-export.json" \
  --media-dir "$AUDIO_RUN/media"

"$AUDIO_PYTHON" worker/train_audio_impacts.py score-sealed \
  --export "$AUDIO_RUN/sealed-export.json" \
  --media-dir "$AUDIO_RUN/media" \
  --artifact "$AUDIO_RUN/linear-model.json" \
  --report-out "$AUDIO_RUN/sealed-report.json"
```

The scorer refuses non-C evaluation rows, missing frozen hashes, altered model
or threshold contents, and any overlap between training and sealed source IDs.

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
