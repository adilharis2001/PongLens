# Third-party licenses

PongLens is a proprietary product. It builds on the open-source software
below. This file records the license of every significant third-party
component in the production system (web app + Mac worker), per the
license audit of 2026-07-22.

## Web app (bundled and served to users)

| Component | License |
| --- | --- |
| Next.js | MIT |
| React / react-dom | MIT |
| @supabase/supabase-js, @supabase/ssr | MIT |
| Uppy (@uppy/core, @uppy/aws-s3) | MIT |
| aws4fetch | MIT |
| motion (Motion One / Framer Motion successor) | MIT |
| @vercel/analytics | MPL-2.0 |
| Tailwind CSS | MIT |
| TypeScript | Apache-2.0 |
| server-only | MIT |

Transitive npm dependencies are MIT/BSD/ISC-family; `npm ls` /
`license-checker` can enumerate them at any time.

## Worker (server-side only, never distributed)

| Component | License | Notes |
| --- | --- | --- |
| BlurBall (ball detector, cogsys-tuebingen) | MIT | pretrained weights + inference code |
| WASB-SBDT (NTT) | MIT | baseline detector family BlurBall ships |
| PyTorch | BSD-3-Clause | |
| NumPy | BSD-3-Clause | |
| OpenCV (opencv-python) | Apache-2.0 | |
| Pillow | MIT-CMU (HPND) | |
| psycopg2-binary | LGPL-3.0 with linking exception | used unmodified, server-side |
| boto3 / botocore / s3transfer | Apache-2.0 | R2 S3 API client |
| requests | Apache-2.0 | |
| ffmpeg / ffprobe | GPL build | invoked as an external binary, server-side only; never distributed to users, so GPL copyleft does not attach to PongLens code |
| yt-dlp | Unlicense (public domain) | YouTube import fetcher |

## Removed

- **ultralytics / YOLO (AGPL-3.0)** — the pose-based server-detection
  stage was removed from production on 2026-07-22. No AGPL code or
  weights remain in the product. Serve attribution now comes from the
  app's ITTF serve rotation. Any future skeleton/pose feature must use
  Apache-licensed RTMPose (e.g. via `rtmlib`) instead.

## Not code dependencies

Supabase, Cloudflare R2, Vercel, and Resend are hosted services
(subprocessors listed in the privacy policy), not linked software.
