# PongLens backlog (not now, documented 2026-07-21)

## Next after Match experience ships
- **Serve trainer** (Adil: "excellent") — tripod solo mode: 30 serves → instant
  placement map + consistency score vs chosen target zone. Uses proven bounce
  detection + homography only. Daily-use retention feature.
- **Pressure fingerprint** — stats split by score state (from user-confirmed
  scorecards): error rate, rally length, serve choice at 9-9 vs 3-1. Pure
  bookkeeping once confirmations accumulate.
- **Auto-commentary highlight reels / TikTok export** — starred/longest points,
  captioned, vertical crop, logo watermark. Distribution-as-feature.

## Maybe
- **Equipment intelligence** — which racket side (pips vs inverted) hit each ball,
  for pips matchups. Hard at 30fps; high value to a niche that pays.

## Engineering constraints for future features
- **Skeleton/pose features must use RTMPose (Apache-2.0)** via the isolated
  `rtmlib`/ONNX runtime. The AGPL ultralytics/YOLO pose stage was removed from
  production 2026-07-22 (license audit); do not reintroduce ultralytics.
  High-precision vision evidence may seed first-server rotation and propose
  player-end-change boundaries, but user corrections always win.

## Rejected for now (revisit with scale)
- Opponent scouting cards (needs network density + consent design)
- Club leagues / venue mode (B2B wedge, revisit if PingPod-style partner appears)
- Surfacing spin/speed/movement/shot-counts (accuracy unproven on transfer)
- Fully automatic scoring as verdicts (assist-only until blind accuracy earns it)
