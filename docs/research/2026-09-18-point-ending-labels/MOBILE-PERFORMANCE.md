# Mobile playback performance

Playback updates now refresh only the clock and slider, leaving the 479-point list alone. Ball overlays draw on video frames and stop continuous work while paused, hidden, or disabled. Controls, original evidence and label saving retain the existing behavior.

| Check | Before | After |
| --- | ---: | ---: |
| Canvas redraws across 60 paused animation frames | 60 | 0 |
| Label property reads across 10 playback ticks, 479 rows | 67,130 | 0 |
| Pending seek updates the clock before video loads | Synchronous parent update | `seeking` event in isolated clock |
| Pause / hide / disable / unmount cancels callback | No | Yes |
| Identical video frame repainted during a stall | Yes | No |

| Verification | Evidence |
| --- | --- |
| Regression | Actual page mounted with 479 synthetic rows; two modes, native video-frame callbacks and animation-frame fallback. Both pass. `node --test scripts/research/point-ending-performance.test.mjs` |
| Existing tests | 244 research tests pass |
| Full build | `npm run build` passes; pre-existing unrelated lint warnings remain |
| Visual reference | Shipped Point-ending labels, `PointEndingReview.tsx`; hierarchy and styling unchanged |
| Phone layout | 393×660, real 479-row local fixture, real Lester video, no horizontal overflow |
| Desktop layout | 1024×900, playback and annotated overlays rendered |
| Interaction | Repeated frame advance; bounce jump; paddle annotation; added rally bounce with last marker; note; saved edits survive reload |
| Save isolation | Browser edits go to temporary local JSON only; no production labels edited |
| Review | Independent review; pending-seek clock delay caught, reproduced and fixed; no remaining findings |
| Limits | Operation counts, not a physical-phone FPS or battery benchmark. Native iOS untouched and untested. Video transfer/decoding costs unchanged. |

Screenshots: `/private/tmp/point-ending-perf-mobile.png` and
`/private/tmp/point-ending-perf-desktop.png`. Local QA imports the real components
and built stylesheet; its font is Arial rather than production Geist.
