# Task 9 addendum — Score the Match media refresh

Completed: 2026-09-05

## Scope

The shipped product label changed from **Score Keeper** to **Score the Match**.
Only the two player tutorial files that could expose the old label were changed:

- `tutorial/player/keepscore.mp4`: the title card, first caption, and first
  narration line now say **Score the Match**.
- `tutorial/player/point.mp4`: the underlying product capture was repeated so
  its closing Tools row visibly says **Score the Match**.

The existing keepscore product capture did not show the tool label and was
reused. Eight of its nine narration clips were also reused; only `l1` was
regenerated. Independent transcription of the new clip was exactly:

> Score the match is built for scoring a whole match far faster than watching
> it back.

The changed narration moved the keepscore render from 49.109 seconds to 49.493
seconds. The catalog value remains correct at 49 seconds, so no duration
metadata changed. No unaffected chapter was captured, rendered, or published.

## Exact production replacements

Both objects were uploaded with `Content-Type: video/mp4` and
`Cache-Control: public, max-age=86400`. Each PUT was followed by HEAD
verification of size and metadata and a full GET whose SHA-256 matched the
local render.

| R2 key | Bytes | Duration | SHA-256 |
| --- | ---: | ---: | --- |
| `tutorial/player/point.mp4` | 7,258,857 | 45.397333s | `9b7032f8842c00ff775cd85ecd7910c941eecd3fd121343a4a3637d21bdcf9ae` |
| `tutorial/player/keepscore.mp4` | 6,991,764 | 49.493333s | `80a9ab3010eb3b54e7642cc31a017001f3d4693ffdd9ea81632be51b922481d7` |

Replacement total: 2 files, 14,250,621 bytes. No unrelated object was
overwritten or deleted.

## Capture and render verification

- The point capture ran against the integrated app state containing the new
  label. The tutorial guard restored the demo account after every attempt,
  including the two stopped setup attempts before the correct localhost host
  was used.
- The rendered keepscore title and opening chapter frame visibly say **Score
  the Match**.
- The rendered point closing Tools row visibly says **Score the Match**.
- Both renders passed the tutorial media verifier: 1080x1920 H.264 video with
  AAC audio; keepscore had 12 cues and point had 10 cues.

## Production contract and playback verification

After production deployment `1e93f727` was READY at `www.ponglens.com`, fresh
authenticated checks against `POST /api/tutorial-url` returned the expected
course contract:

- player web: 9/9 chapter URLs;
- coach web: 9/9, including paid match reviews;
- player iOS: 9/9;
- coach iOS: 8/8, with no paid-review chapter or URL.

All 35 returned URLs served `bytes=0-1023` as HTTP 206 with exactly 1,024 bytes
and an MP4 `ftyp` signature.

A fresh authenticated production UI playback pass used the visible desktop
video element and the real play control:

- player **Score a point** advanced to 0.517s, `readyState` 4, from
  `/ponglens-media/tutorial/player/point.mp4`;
- player **Score the Match** advanced to 0.520s, `readyState` 4, from
  `/ponglens-media/tutorial/player/keepscore.mp4`;
- coach **Start here** advanced to 0.523s, `readyState` 4, from
  `/ponglens-media/tutorial/coach/coach-start.mp4`.

Each visible player reported 1080x1920 source dimensions. The production UI
showed 9 player chapters, 9 coach chapters, and the coach-only paid-review
chapter. No signed URL or credential was persisted in this report.

Final scoped verification after cleanup:

- `npm run test:tutorial`: 112/112 pass;
- `npm run test:learn`: 36/36 pass;
- `npm run learn:ios:check`: pass;
- `git diff --check`: pass.
