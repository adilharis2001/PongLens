# Task 9 report — publication dry-run and approval boundary

Date: 2026-09-04
Starting HEAD: `64aacee5`

## Result

The course-aware publisher now selects its files and object keys only from
the Learn catalog, verifies every local output before publication, emits an
exact dry-run manifest, and delays credential loading until a real publish is
requested. A real publish writes only `tutorial/player/<slug>.mp4` or
`tutorial/coach/<slug>.mp4`, uploads with the fixed metadata below, and checks
the remote `Content-Length` with HEAD after every PUT.

No R2 credentials were loaded by either dry-run. No PUT, HEAD, upload,
publication, deletion, or TestFlight action was performed. The old flat
`tutorial/<slug>.mp4` objects remain outside this task's write scope.

## Fixed upload metadata

- Content-Type: `video/mp4`
- Cache-Control: `public, max-age=86400`
- Bucket: `ponglens-media`

## Exact verified dry-run manifest

| Local output | R2 key | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `out/player/home.mp4` | `tutorial/player/home.mp4` | 5,312,018 | `5555c4d788957bc680a722b4211ac1e17f6f57e7d924265808ed943584766824` |
| `out/player/upload.mp4` | `tutorial/player/upload.mp4` | 5,519,890 | `0c71b79ca2637dde612fa769f467706414363c1908ad8f25ce5ca0f8779d3374` |
| `out/player/viewer.mp4` | `tutorial/player/viewer.mp4` | 5,761,840 | `7b468675987fffa74e911c499df6c23dc30f0d10762f4b85a909c38083f6ada2` |
| `out/player/point.mp4` | `tutorial/player/point.mp4` | 7,053,291 | `b894b1562070a3445a66c4b8568fdf1ae6e3e067e7b268da62e95f8b95ccb084` |
| `out/player/keepscore.mp4` | `tutorial/player/keepscore.mp4` | 7,029,269 | `69ae1da364d9e84f04e9c803d7a3d336c3351bd0ff77dd844bff8d5cf5a4e677` |
| `out/player/analysis.mp4` | `tutorial/player/analysis.mp4` | 5,249,574 | `e608a7624cd25fdee0149d36d2ddf8bdcea10aa280e1c18035446e7898be210a` |
| `out/player/export.mp4` | `tutorial/player/export.mp4` | 6,965,089 | `d008f748bbe33433e1e01637acfb4b886f7bdcabc52a04b639af584b7be41296` |
| `out/player/coach.mp4` | `tutorial/player/coach.mp4` | 6,414,616 | `ce99bc848af00a952dd4e5931b4fb9a1eac2214b203c5cd9fb1cdb1e8197845b` |
| `out/player/journal.mp4` | `tutorial/player/journal.mp4` | 5,582,580 | `961f1cca8100dfa394efdd54b837d7cab7696f11d3cbb825f82f149803bd0a03` |
| `out/coach/coach-start.mp4` | `tutorial/coach/coach-start.mp4` | 3,852,944 | `519e45a2a5d6ca8099f4ee2038bdefeda33105b374724fcb22fdc7cb59505cb7` |
| `out/coach/coach-add-student.mp4` | `tutorial/coach/coach-add-student.mp4` | 3,372,729 | `21db4bf6484462eaa02ea4849b12081253ebdce65a2c579a9aa845b5335f3c3e` |
| `out/coach/coach-connect-account.mp4` | `tutorial/coach/coach-connect-account.mp4` | 4,448,808 | `e73c9f971e0f1d7da222d2548b3a81f6c21c1470ccaf7310be0fac0aa7dc7b3a` |
| `out/coach/coach-lesson-entry.mp4` | `tutorial/coach/coach-lesson-entry.mp4` | 4,601,678 | `2bb427d2d6347a81d69fed4d70e7995be61b17feaec750749da9c7ca084d511a` |
| `out/coach/coach-audio-lesson.mp4` | `tutorial/coach/coach-audio-lesson.mp4` | 2,447,724 | `cab7163eb04da2424cc40a28b1a24d6199ec928d30c391807021d516ff43f1f3` |
| `out/coach/coach-share-entry.mp4` | `tutorial/coach/coach-share-entry.mp4` | 4,344,717 | `8380d8f1b3c74900d8dd16b2a43f39399944ecada8841af9a1d3a9ddd46cd220` |
| `out/coach/coach-review-match.mp4` | `tutorial/coach/coach-review-match.mp4` | 5,501,905 | `daba42a8cb202e9e141c9ef76b001b6f39f728dd5129430ce1ce287db75bbbe4` |
| `out/coach/coach-feedback.mp4` | `tutorial/coach/coach-feedback.mp4` | 4,661,611 | `497dc24afe1e01df72ae88f71439c07e2375342850c10caf7e66585b56480825` |
| `out/coach/coach-paid-review.mp4` | `tutorial/coach/coach-paid-review.mp4` | 6,850,343 | `48688d6bcb4432974029160481be46b108afcca70991e8f3d9882b896b7a85ef` |

Player total: 9 files, 54,888,167 bytes.

Coach total: 9 files, 40,082,459 bytes.

Combined total: 18 files, 94,970,626 bytes.

## TDD record

The implementation followed separate RED to GREEN cycles for import safety,
catalog selection, CLI validation, verifier-gated manifest generation, fixed
upload metadata and HEAD size checks, traversal rejection, changed-file
rejection, and a credential-free dry-run. Network behavior was tested only
against an injected in-memory transport.

## Verification

- Real player dry-run: 9 verified files, 54,888,167 bytes.
- Real coach dry-run: 9 verified files, 40,082,459 bytes.
- Independent report-to-filesystem path, size, and SHA-256 comparison: 18/18.
- `npm run test:tutorial`: 112/112 pass.
- `npm run test:learn`: 36/36 pass.
- `npm run learn:ios:check`: pass.
- `npm run build`: pass, 142 static pages; only existing lint warnings.
- iOS simulator build on iPhone 17 Pro / iOS 26.5: `** BUILD SUCCEEDED **`;
  existing Swift migration and deprecation warnings remain.
- `git diff --check`: pass before commit.

## Process note

The referenced Task 9 brief was absent from the worktree. The task proceeded
from the authoritative Task 9 plan section and the ledger's explicit-approval
ruling after the controller confirmed that this was not a blocker.

## Approval boundary

Stop here. Running either command without `--dry-run` requires explicit user
approval for the exact 18 mappings above. Post-publish web/iOS playback checks
and TestFlight remain pending until publication is approved and completed.
