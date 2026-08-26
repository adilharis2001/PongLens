# Spin estimation from 30 fps monocular video — feasibility study

2026-08-26. The question: given a calibrated table and ball detections
from an ordinary 30 fps side-on iPhone recording, can PongLens infer the
spin on the ball — as categories (topspin / backspin / sidespin,
light / heavy), not an RPM number — from flight and bounce behaviour
alone? Verdict up front: **yes for topspin-vs-backspin on serves, with
the bounce as the main sensor; no for an RPM number; sidespin needs a
channel we currently throw away.** The blocking engineering problem is
not physics or frame rate — it is that only ~14% of serve windows
yield a clean bounce measurement with today's track and event quality.

Everything here is reproducible from this directory. Scripts run on the
TTVid venv (`/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`)
except `real_extract2.py` (worker venv, needs psycopg2 + R2 access).

---

## 1. What the literature says (two full reviews commissioned for this study)

The short version, every claim tied to a source:

- **This exact problem was solved for broadcast footage in 2025.**
  Kienzle et al. (CVPR-W 2025, arXiv:2504.19863): 2D ball track + 13
  table keypoints, transformer trained on 50,000 simulated trajectories
  with noise/dropout/truncation augmentation, **zero real labels** —
  92.0% binary topspin/backspin on real 50 Hz monocular broadcast video.
  The follow-up ("Uplifting Table Tennis", arXiv:2511.20250) handles
  **20–60 fps** with timestamp encodings: 89.5% on broadcast. Their
  ablation: the "sudden end" truncation augmentation alone was worth
  +22 points; input-as-keypoints (not pixels) is what closes sim-to-real.
- **TT3D (arXiv:2504.10035)** — same Tübingen group as our BlurBall
  detector — reconstructs 3D trajectories monocularly at 25 fps by
  fitting flight physics anchored on the bounce (a 2D bounce detection
  back-projects to an exact 3D point on the known table plane), and
  reads spin off the fit. Side view: 97.3% success, 12.4 cm MAE —
  their worst view (end-on) is 3× worse, which independently confirms
  PongLens's side-on camera doctrine.
- **An RPM number is not a deliverable.** Achterhold et al. (L4DC 2023):
  even with four cameras at 180 Hz, spin from positions is so weak that
  ball-launcher metadata "drastically" beat it. Tennis validation (Cant
  et al. 2020, Hawk-Eye-grade ten-camera data): ±220 rpm at best,
  useless above 75 rev/s. Everyone with money (Sony AI: 9 cameras at
  200 Hz; SpinDOE: 350 fps + dotted balls) measures spin directly
  rather than inferring it. Consumer products on plain phone cameras
  (SwingVision) ship spin *type* only. So does everyone else.
- **Direct visual spin is physically impossible at 30 fps**: serves spin
  at 14–63 rev/s (Yoshida et al. 2014, 1000 fps study of world-class
  serves), i.e. 0.5–2 full revolutions *between* consecutive frames.
- **The physics is generous in table tennis specifically.** The ball is
  2.7 g: Magnus acceleration is kM·|ω||v| with kM ≈ 3.6×10⁻³, which is
  ~1 g at loop spin — the trajectory bends more per unit of spin than
  any other ball sport. And the bounce is a spin amplifier: in the grip
  regime v'ₓ = 0.6·vₓ + 0.4·Rω (thin shell, I = ⅔mr²), so the
  pre/post-bounce speed ratio spans ~0.1 (heavy chop) to ~1.1 (heavy
  loop) — a 10× dynamic range. Sensitivity ≈ 0.05 m/s per rev/s.
- Two structural blind spots no method escapes: **spin about the flight
  axis (corkscrew) is invisible in flight** (ω×v = 0) and only weakly
  visible at the bounce; and **the lift curve saturates** near spin
  ratio ~0.5 (Miyazaki's "lift crisis"), so heavy-vs-very-heavy
  compresses. Tebbe et al. found medium and heavy backspin confounded
  even with multi-camera 3D tracks; our simulation reproduces this
  (Coulomb slip caps the friction impulse — the bounce stops telling
  backspin levels apart once the ball slides throughout contact).

## 2. What PongLens already has (inventory highlights)

- **BlurBall runs on every native frame** (512×288 model input, output
  mapped back to source pixels) and its JSONL rides through the whole
  pipeline. Coverage ~76–92% of frames around serves.
- **The model already estimates a blur angle and length per detection
  and `blurball_infer.py` throws both away** at the JSONL boundary
  (`TTVid/vendor/blurball_infer.py:166-175`). Blur length/angle is a
  per-frame velocity vector (the BlurBall paper measures 1.2 px length
  MAE, 6.8° angle MAE). This is the single cheapest high-value patch in
  the whole area — and it is the missing channel for sidespin (§5).
- Bounce candidates already persist per point with frame, pixel, and
  metric table coordinates (`points.placement`, v3). Serve first/second
  bounce identification exists (three implementations; the shipped
  motif detector is 41%-wrong, which matters a lot below).
- Per-segment quadratic fits with sub-frame bounce refinement already
  exist in `points_pipeline.py` (`fit_play`, `refine_bounce`).
- **Full camera pose from the quad**: decomposing the calibration
  homography with an assumed focal length recovers the camera position
  essentially exactly in simulation (`sim.camera_from_H`; verified to
  cm-level on synthetic cameras). Caveat from the 2026-08-25 focal
  study: solving the focal length itself from one quad was measured and
  refused — the focal must come from somewhere else (iOS knows its
  lens; imports can assume ~66° HFOV and eat the error, which the
  robustness runs below say is tolerable for classification).
- Ground truth that already exists: `points.serve_spin` /
  `serve_sidespin` hand labels on 69 points (44 back / 15 top / 6 none),
  concentrated in matches that the serve-study detection caches cover.

## 3. The 30 fps arithmetic

Frames between racket contact and first bounce, and per hop:

| shot | speed | flight | frames @30 |
|---|---|---|---|
| slow serve | 5 m/s | 160 ms | ~5 |
| fast serve | 9 m/s | 133 ms | ~4 |
| push | 4.5 m/s | 289 ms | ~9 |
| drive | 12 m/s | 150 ms | ~4.5 |
| loop | 17 m/s | 118 ms | ~3.5 |
| smash | 25 m/s | 92 ms | ~3 |
| **serve hop (bounce1→bounce2)** | — | 370–530 ms | **11–16** |

Serves are the tractable target: slowest ball, most frames, two bounces
on the calibrated plane, and the server known from the scored rotation.
Rally spin at 3–5 frames per segment is out of reach for v1 (the
literature's minimum is ~3 frames per segment *with* a learned model).

## 4. Simulation study (experiments A, B)

`sim.py`: RK4 flight (drag kD=0.112 m⁻¹, Magnus with Cl = min(0.6·S,
0.42)), Cross-style bounce with slip/grip for a thin shell (ez=0.90,
μ=0.25), pinhole cameras sampled from the real placement guidance
(side-on, 2.2–4.5 m out, 1.0–2.0 m high, fx 1250–1600), 30 fps with
phase jitter, 2 px noise plus motion-blur-scaled noise, 15% dropout.
3,000 legal serves across a 3×3×3 label grid (top/none/back ×
L/none/R × light/med/heavy, magnitudes 15–110 rev/s).

**Experiment A — are the classes separable?** Features computable in
production today (homography ground tracks + given bounce events),
multinomial logistic + kNN, 5-fold:

| task | chance | 30 fps practical | oracle (true bounce velocities) |
|---|---|---|---|
| top/none/back | 39% | **66%** | 91% |
| **top vs back (binary)** | 58% | **86–91%** | 100% |
| side L/none/R | 35% | 39% (clean detections: 45%) | 40% (bounce can't see it) |
| light/med/heavy | 37% | 44% | 55% |
| light vs heavy (binary) | 55% | 66% | 80% |

The binary top/back number independently reproduces Kienzle's 92% (they
are at 50 Hz with a transformer; we are at 30 fps with hand features —
a learned sequence model should land between our 86–91% and their 92%).
The clean-detection control barely moves top/back (66%→66%): **the
limit is the feature set, not detection noise** — headroom for the
learned model. The oracle row says the bounce *event* itself carries
near-perfect top/back information; everything lost is measurement.

**Why sidespin fails in this design, precisely.** True sidespin ground
curvature over the serve hop is real but tiny (±0.014 of hop length ≈
2 cm sagitta — verified against true 3D positions). Monocularly, the
homography ground track adds a parallax bulge from ball height (~20-45
cm for a typical hop) in *almost exactly the same direction* (lateral to
travel) with *exactly the same time profile* (4s(1−s)), and pixel noise
alone is ~1–2 cm on the plane. Subtracting the predictable ballistic
parallax (apex = gT²/8 from hop duration alone; camera from the quad)
helps only marginally because the Magnus-lift residual contaminates the
correction in the same direction. Conclusion: **sidespin is not
recoverable from plane-projected positions at 30 fps; it needs
per-frame velocity directions (blur angle) or the full 3D fit.**
The blur-angle arithmetic is favourable: a sidespin serve accumulates
~40–70° of heading drift contact→receiver; blur angle is good to ~7°
per frame, ~10 usable frames → SNR ≈ 20.

**Experiment B — full physics-inverse fit** (fit p0, v0, ω through
flight + bounce to match pixels; camera from quad + known focal;
Levenberg-Marquardt, 3 starts, n=40): top/back read off the fitted spin
vector = **60%** (feature classifier: 86–91%); side = 47.5% (the best
any positional method managed, still weak); spin magnitude median
relative error **6.6×**; spin axis median error **71°**. A cheaper
2-start/140-iteration budget collapses to 35% top/back — the optimizer
lands in local minima at plausible reprojection cost. This is Achterhold
et al.'s weak-observability result reproduced monocularly: **use the
physics as a simulator and feature generator, not as a runtime inverse
solver.** (`experiment_b.py`, `experiment_b_lite.py`,
`out/expB_fits.json`, `out/expB_lite.json`. The model-mismatch
robustness variant `run_b_mismatch.py` was prepared but not run — moot
once the well-specified fit already fails.)

**Bounce-model saturation found by the simulation and confirmed in the
literature**: once the contact slides throughout (backspin at normal
serve incidence), Coulomb friction caps the impulse and medium vs heavy
backspin produce the *same* bounce. Backspin *presence* is loud;
backspin *depth* mostly is not (from the bounce; the pre-bounce float
carries some of it). Pure sidespin (vertical axis) produces zero bounce
kick — the contact point sits on the spin axis; the lateral-kick
folklore is about corkscrew components.

## 5. Real footage (experiment C)

Two sources, no reprocessing:

**Labeled serves** (`real_extract2.py`, `real_analyze.py`): 34 of the
69 hand-labeled spin serves live in matches covered by the committed
serve-study tracks (`public/research/serve-detector/*.json`). After
per-point clock re-anchoring (the study's cut copies pre-date a pad
change; calibrated by matching bounce-candidate pixels into the track)
and production quads from match.json (which reproduce the stored u,v
exactly), 29 extracted — and **only 4 survive physical-sanity gates**
(plausible speeds, no heading reversal at "bounce 1", hop straddles the
net at hop speed 1–15 m/s). All 4 are labeled backspin; their bounce
speed ratios are 0.35, 0.38, 0.54, 0.68 — inside the physics backspin
band. The 25 rejects fail in a characteristic way: heading reverses
80–180° at the supposed first bounce, i.e. **the chosen bounce pair is
the server bouncing the ball before serving**, plus tracker teleports.
The signal did not fail; serve-event identification did — the known
41%-wrong serve detector problem wearing a new hat.

**Scale check on detector serves** (`real_scale.py`): the recall
research files carry full-match tracks, quads and shipped-detector
serves. 253 serves → **35 clean bounce measurements** (14% yield —
same story). The ratio distribution is structured, not noise:
a 0.8–1.1 cluster (flat/top serves), a 0.1–0.5 backspin tail, and
**per-player signatures that match watching them play**: chris_rc
median 0.42 (heavy backspin server), ishan_rc 0.96 (flat/topspin),
chris_a 0.81 in between. `out/fig_real.png`.

## 6. Conclusions

1. **Feasible v1 product**: serve spin as top/back/none plus a coarse
   heavy-backspin flag, from the bounce speed ratio plus hop features,
   with per-serve confidence and refuse-don't-guess. Realistic accuracy
   ~85–90% on top-vs-back for serves that pass hygiene gates, matching
   both our simulation and the published 50 Hz result. Per-player
   aggregates ("serves mostly heavy backspin") are trustworthy well
   before per-serve badges are (1/√N).
2. **Never print RPM.** Nobody can from this data; categories only.
3. **Sidespin needs the blur channel.** Patch `blurball_infer.py` to
   keep angle/length (they are already computed), then sidespin L/R
   becomes an accumulated-heading-drift feature. Until then, no
   sidespin claims.
4. **The gating work is event hygiene, not modelling**: distinguish the
   serve's bounce pair from pre-serve ball-bouncing (the heading-
   reversal gate above catches it almost perfectly and is nearly free),
   and reject tracker teleports (the chunking rules already exist in
   `points_v2.build_track` / `placement_reconstruction.split_track_chunks`).
5. **Architecture recommendation**: start with the physics-feature
   classifier (weeks, interpretable, sets the floor and builds the
   evaluation corpus); grow to the Kienzle-style sim-trained sequence
   model (input: per-frame track + quad + blur vectors) once the serve
   windows are clean — published evidence says it transfers with zero
   real labels, and our clean-control says there is real headroom.
6. **Ground truth path**: label serve spin in the existing review UI at
   scale (the columns exist; 200–300 labeled serves across venues would
   be a real evaluation set); a session with a ball machine at fixed
   spin settings filmed side-on at 30 fps AND 240 fps slo-mo (iPhone
   can do both) would give absolute calibration for the strength axis.

## Files

- `sim.py` — flight + bounce + camera + 30 fps observation model
- `sanity.py` — physics smoke tests and the frame-budget table
- `gen_serves.py` — labeled serve dataset generator (3,000 in `out/serves.json`)
- `features.py` — production-computable features incl. parallax correction
- `experiment_a.py` — separability tiers (oracle vs practical)
- `experiment_b.py` — monocular physics-inverse fit (9 params)
- `real_extract2.py` / `real_analyze.py` — labeled real serves
- `real_scale.py` — detector-serve ratio distribution at scale
- `plots.py`, `plots2.py` — figures in `out/`
