# Point Rally Video Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separately playable rally clip beneath every point in the standalone placement-map comparison report.

**Architecture:** The report CLI accepts an optional source-video path and extracts one frame-accurate MP4 per match point using `ffmpeg`. Reconstruction records carry relative clip filenames, and the pure HTML renderer conditionally embeds native, metadata-only video players without changing placement status or map suppression.

**Tech Stack:** Python 3, `unittest`, `subprocess`, ffmpeg 8, HTML5 video, existing PongLens placement evaluator.

## Global Constraints

- Every point row with video enabled contains its own native video player beneath the before/after maps.
- Players use browser-native controls, never autoplay, and use `preload="metadata"`.
- Generated MP4 clips live inside the standalone report directory.
- Report generation without `--video` remains backward compatible.
- No Supabase, R2, or production match records are changed.
- Clip extraction failures identify the affected point instead of emitting a broken player.

---

### Task 1: Frame-accurate rally clip extraction

**Files:**
- Modify: `worker/eval/render_placement_match.py`
- Test: `worker/tests/test_placement_reconstruction.py`

**Interfaces:**
- Consumes: `video_path: Path`, `output_path: Path`, `t0: float`, `t1: float`, `point_idx: int`
- Produces: `extract_point_clip(video_path, output_path, t0, t1, point_idx, runner=subprocess.run) -> None`

- [ ] **Step 1: Write failing extraction tests**

Add tests that call `extract_point_clip` with a mock runner and assert:

```python
command = runner.call_args.args[0]
self.assertIn("-ss", command)
self.assertIn("1.250", command)
self.assertIn("-t", command)
self.assertIn("2.500", command)
self.assertIn("libx264", command)
self.assertIn("+faststart", command)
```

Also assert that `t1 <= t0` raises:

```python
with self.assertRaisesRegex(ValueError, "Point 7"):
    extract_point_clip(video, output, 3.0, 3.0, 7, runner)
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
python3 -m unittest \
  worker.tests.test_placement_reconstruction.RenderReportTests.test_clip_extraction_uses_exact_point_range \
  worker.tests.test_placement_reconstruction.RenderReportTests.test_clip_extraction_rejects_invalid_range -v
```

Expected: fail because `extract_point_clip` is not defined.

- [ ] **Step 3: Implement extraction**

Add `subprocess` and implement:

```python
def extract_point_clip(
    video_path: Path,
    output_path: Path,
    t0: float,
    t1: float,
    point_idx: int,
    runner: Any = subprocess.run,
) -> None:
    if t1 <= t0:
        raise ValueError(f"Point {point_idx} has invalid video range")
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{t0:.3f}", "-i", str(video_path),
        "-t", f"{t1 - t0:.3f}",
        "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-movflags", "+faststart", str(output_path),
    ]
    try:
        runner(command, check=True)
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError(
            f"Point {point_idx} video extraction failed"
        ) from error
```

- [ ] **Step 4: Run the focused tests**

Run the command from Step 2.

Expected: both tests pass.

- [ ] **Step 5: Commit the extraction unit**

```bash
git add worker/eval/render_placement_match.py \
  worker/tests/test_placement_reconstruction.py
git commit -m "feat: extract point rally video clips"
```

---

### Task 2: Embed one player in every point row

**Files:**
- Modify: `worker/eval/render_placement_match.py`
- Test: `worker/tests/test_placement_reconstruction.py`

**Interfaces:**
- Consumes: optional `video_file: str` on each reconstruction record
- Produces: conditional `<video controls preload="metadata">` markup in `build_report`

- [ ] **Step 1: Write a failing report-rendering test**

Create two reconstruction fixtures containing `video_file` and assert:

```python
report = build_report(match, reconstructions)
self.assertEqual(report.count("<video "), 2)
self.assertEqual(report.count('preload="metadata"'), 2)
self.assertNotIn("autoplay", report)
self.assertIn('src="point-01.mp4"', report)
self.assertIn('src="point-02.mp4"', report)
self.assertIn("Point 1 rally video", report)
```

Retain the existing no-video smoke test and assert it contains no `<video`.

- [ ] **Step 2: Run the rendering tests and verify failure**

Run:

```bash
python3 -m unittest \
  worker.tests.test_placement_reconstruction.RenderReportTests -v
```

Expected: the video assertions fail because the renderer ignores
`video_file`.

- [ ] **Step 3: Implement conditional player markup**

In each row, derive:

```python
video_file = item.get("video_file")
video_html = (
    f'<div class="rally-video"><h3>Point {idx} rally video</h3>'
    f'<video controls preload="metadata" playsinline '
    f'aria-label="Point {idx} rally video">'
    f'<source src="{html.escape(video_file)}" type="video/mp4"/>'
    "Your browser could not play this rally clip.</video></div>"
    if video_file
    else ""
)
```

Place `video_html` after `.maps`. Add responsive CSS:

```css
.rally-video{margin:18px auto 0;max-width:820px}
.rally-video video{display:block;width:100%;border-radius:12px;background:#09090b}
```

- [ ] **Step 4: Run the rendering tests**

Run the command from Step 2.

Expected: all `RenderReportTests` pass.

- [ ] **Step 5: Commit the report UI**

```bash
git add worker/eval/render_placement_match.py \
  worker/tests/test_placement_reconstruction.py
git commit -m "feat: embed rally videos in placement report"
```

---

### Task 3: Wire video extraction into the report CLI

**Files:**
- Modify: `worker/eval/render_placement_match.py`
- Test: `worker/tests/test_placement_reconstruction.py`

**Interfaces:**
- Consumes: optional CLI argument `--video PATH`
- Produces: `generate_report(..., video_path: Path | None = None)` and a `video_file` field on video-enabled reconstruction records

- [ ] **Step 1: Write failing orchestration tests**

Patch `extract_point_clip`, call a two-point report-generation helper with a
video path, and assert it receives:

```python
[
    call(video, output / "point-01.mp4", 0.5, 3.5, 1),
    call(video, output / "point-02.mp4", 11.47, 15.97, 2),
]
```

Assert the returned records contain `point-01.mp4` and `point-02.mp4`. Add a
test that a nonexistent `video_path` raises `FileNotFoundError` before point
processing.

- [ ] **Step 2: Run the orchestration tests and verify failure**

Run:

```bash
python3 -m unittest \
  worker.tests.test_placement_reconstruction.RenderReportTests -v
```

Expected: fail because `generate_report` does not accept or process
`video_path`.

- [ ] **Step 3: Wire the optional video path**

Update the signature:

```python
def generate_report(
    match_path: Path,
    blurball_path: Path,
    output: Path,
    server_truth_path: Path | None = None,
    audio_path: Path | None = None,
    video_path: Path | None = None,
) -> list[dict[str, Any]]:
```

Before processing points, reject a missing supplied path. For each point:

```python
if video_path is not None:
    video_file = f"point-{idx:02d}.mp4"
    extract_point_clip(
        video_path,
        output / video_file,
        float(point["t0"]),
        float(point["t1"]),
        idx,
    )
    reconstruction["video_file"] = video_file
```

Add:

```python
parser.add_argument("--video", type=Path)
```

and pass `video_path=args.video` from `main`.

- [ ] **Step 4: Run all Python tests**

Run:

```bash
python3 -m unittest discover -s worker/tests -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit CLI integration**

```bash
git add worker/eval/render_placement_match.py \
  worker/tests/test_placement_reconstruction.py
git commit -m "feat: generate video-enabled placement reports"
```

---

### Task 4: Regenerate and verify the Vaibhab review artifact

**Files:**
- Produce: `/tmp/ponglens-placement-v3/vaibhab-final-20260726-video/index.html`
- Produce: `/tmp/ponglens-placement-v3/vaibhab-final-20260726-video/reconstructed-match.json`
- Produce: `/tmp/ponglens-placement-v3/vaibhab-final-20260726-video/point-01.mp4` through `point-17.mp4`

**Interfaces:**
- Consumes: source match JSON, BlurBall JSONL, audio candidates, server fixture, and `vaibhab-raw.mp4`
- Produces: a self-contained 17-point placement and rally-video review directory

- [ ] **Step 1: Generate into a fresh directory**

Run:

```bash
mkdir -p /tmp/ponglens-placement-v3/vaibhab-final-20260726-video
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/render_placement_match.py \
  --match-json /tmp/ponglens-calibration-audit/r2/fd5c5d50-5797-4766-bee2-cffae64c7531.json \
  --blurball /tmp/ponglens-calibration-audit/vaibhab-blurball.jsonl \
  --server-truth worker/tests/fixtures/vaibhab_points.json \
  --audio-impacts /tmp/ponglens-calibration-audit/vaibhab-audio-candidates.json \
  --video /tmp/ponglens-calibration-audit/vaibhab-raw.mp4 \
  --output /tmp/ponglens-placement-v3/vaibhab-final-20260726-video
```

Expected: 17 points are written with unchanged placement totals.

- [ ] **Step 2: Verify HTML, JSON, and clip count**

Run:

```bash
test "$(rg -c 'class=\"point-row\"' /tmp/ponglens-placement-v3/vaibhab-final-20260726-video/index.html)" = 17
test "$(rg -c '<video ' /tmp/ponglens-placement-v3/vaibhab-final-20260726-video/index.html)" = 17
test "$(find /tmp/ponglens-placement-v3/vaibhab-final-20260726-video -name 'point-*.mp4' | wc -l | tr -d ' ')" = 17
jq -e 'all(.points[]; .video_file | test(\"^point-[0-9]{2}\\\\.mp4$\"))' \
  /tmp/ponglens-placement-v3/vaibhab-final-20260726-video/reconstructed-match.json
```

Expected: every command exits zero.

- [ ] **Step 3: Probe every generated clip**

Run:

```bash
for clip in /tmp/ponglens-placement-v3/vaibhab-final-20260726-video/point-*.mp4; do
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=codec_name,width,height \
    -show_entries format=duration \
    -of json "$clip"
done
```

Expected: each file has an H.264 video stream and positive duration.

- [ ] **Step 4: Run full repository verification**

Run:

```bash
python3 -m unittest discover -s worker/tests -v
npm run test:placement
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Expected: tests, type-check, lint, production build, and diff validation all
pass.

- [ ] **Step 5: Inspect final git state**

Run:

```bash
git status --short
git log --oneline -12
```

Expected: clean worktree with the video-review commits on
`feature/placement-reconstruction`.
