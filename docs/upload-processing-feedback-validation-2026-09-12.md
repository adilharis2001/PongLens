# Upload feedback validation, 2026-09-12

The camera warning and observed processing stages are implemented across web, mobile web and iOS. GPT-5.6 Sol ran the tests and rendered checks; Astra implemented the production changes. Numeric completion estimates remain disabled because the available timings did not support a reliable range.

| Improvement | Verified behavior |
| --- | --- |
| Camera view | Compares existing stills using local CPU work, with no additional paid AI request. One 20-second deadline includes probing, optional extraction and comparison. |
| Player warning | Appears inside the existing match card; recommends a fixed view of the same table. Selecting a trim outside the measured change hides it. Processing remains allowed. |
| Processing status | Shows queued, observed stage and delayed states. A background content or highlight job cannot hide the primary match-processing job. |
| Completion times | Removes the blanket 90-minute promise. Records verified video profiles and claim/stage/progress/ready/released events for future calibration. No numeric ETA is returned to clients. |
| Privacy and availability | Owner-scoped feedback; no private URLs, screenshots or exception strings in timing records. Recording/check failures do not fail a player's job. |

| Sol verification | Result |
| --- | --- |
| Camera feasibility | 10 real fixed-camera recordings: no warnings; 32 synthetic sustained changes: all detected; 70 nuisance controls: no warnings. |
| Web | Full production build and lint passed; 19 behavior tests passed. Actual screens rendered at desktop and 393×660 mobile. |
| iOS | Full clean simulator build 194 passed; 1,114 native checks passed. Actual Home and MatchDetail screens rendered on iPhone 17 Pro, iOS 26.5. |
| Database | Real disposable PostgreSQL tests passed for owner isolation, write privileges, malformed inputs, primary-job priority and fresh/missing/stale worker observations. |
| Worker | Both source lineages tested. The deployed-line candidate passed 109 worker checks, 25 release checks, actual model smoke, repeated side-change smoke, 16 point-parity checks and final integrity verification. |
| Current-main regression | Camera/telemetry, ordinary processing and candidate workflow checks passed. Two unrelated highlight database tests failed identically on unchanged main `6a36f82c`; the local test database lacks a highlight function/state expected by those tests. |

| Rendered test state | Web | iOS |
| --- | --- | --- |
| Processing and camera warning | [393×660 mobile](/private/tmp/ponglens-feedback-ui-baseline-20260912/final-web/web-raw-processing-mobile-393x660.png), [desktop](/private/tmp/ponglens-feedback-ui-baseline-20260912/final-web/web-raw-processing-desktop-1440x900.png) | [Native screen](/private/tmp/ponglens-feedback-ui-baseline-20260912/final-ios/ios-processing-iphone17pro-26.5.png) |
| Upload check and warning | [Mobile](/private/tmp/ponglens-feedback-ui-baseline-20260912/final-web/web-raw-checking-mobile-393x660.png) | [Native screen](/private/tmp/ponglens-feedback-ui-baseline-20260912/final-ios/ios-checking-iphone17pro-26.5.png) |
| Trim hides warning | [Mobile](/private/tmp/ponglens-feedback-ui-baseline-20260912/final-web/web-raw-trim-hides-warning-mobile-393x660.png) | [Native screen](/private/tmp/ponglens-feedback-ui-baseline-20260912/final-ios/ios-trim-hides-warning-iphone17pro-26.5.png) |
| Home stage | [Mobile](/private/tmp/ponglens-feedback-ui-baseline-20260912/final-web/web-home-processing-mobile-393x660.png) | [Native screen](/private/tmp/ponglens-feedback-ui-baseline-20260912/final-ios/ios-home-processing-iphone17pro-26.5.png) |

| Limit / release boundary | Status |
| --- | --- |
| Naturally moving match corpus | Not available locally. Evidence supports an advisory warning, not rejection or a claim that movement happened during a particular point. |
| Numeric ETA | Four usable current-release completions; historical holdout ranges were too broad and insufficiently supported. More complete comparable runs are needed. |
| Physical-device test | Not performed; native verification used the simulator. |
| TestFlight | Build 194 prepared in source; local archive/export status recorded separately. Latest App Store Connect build number could not be queried through the managed Xcode session. No upload yet. |
| Production | No migration, main-branch push or worker activation performed. Screenshot approval is required before publishing. |
| Worker candidate | Exact source/release IDs, staged path, rollback and model evidence are in [worker-release-validation-2026-09-12.md](worker-release-validation-2026-09-12.md). |
