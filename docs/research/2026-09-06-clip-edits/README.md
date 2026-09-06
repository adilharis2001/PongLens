# Clip edits: deep reads, 2026-09-06

Read-only studies of everything behind Split, Join, Adjust and the plus
button, made for `docs/superpowers/specs/2026-09-06-instant-clip-edits-design.md`.
Line numbers are from the tree on 2026-09-06. Nothing was run against the
live database; statements about policies come from the migration files.

| File | Covers |
| --- | --- |
| `web-player-and-modify.md` | Player, ModifyClip, modifyOps, playhead, PointDetail, PointSheet, ClipPlayer, media-url; the three clocks; every `edited` consumer; weaknesses |
| `web-plus-button.md` | InsertPoint, insertGeometry, `insert_point`; what shipped versus the August 30 design; sixteen weaknesses |
| `ios.md` | PlayerTakeover, ModifySheet, InsertSheet, PointDetailScreen, PointExtras, Playhead, StoryRenderer, RecordingQueue; divergences from web |
| `worker-and-database.md` | `process_reclip` end to end, cut and clip encoding, queue and job lifecycle, `edited` contract, ledger, retention, RLS |
| `clip-consumers.md` | Every reader of `points.clip_path` and the cut video on all surfaces; what a phone-made clip must satisfy |
