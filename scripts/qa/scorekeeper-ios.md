# Native scorekeeper fixture

This fixture opens the shipped `PlayerTakeover` and `MatchDetailModel` with a local 27-second video and three deterministic points. It never uses a real account, keychain session, production URL, upload queue, or forwarded network request. Run it only as a Debug build on the dedicated simulator and always pass the exact `--qa-scorekeeper` argument.

## Build and install

```sh
QA_DEVICE=E2EE2EA3-19DD-40A7-98C4-329D09277032
QA_DERIVED=/private/tmp/ponglens-scorekeeper-current-native
QA_PACKAGES=/Users/adil/Library/Developer/Xcode/DerivedData/PongLens-ayxrpyljajmbsafjsrfgauijvgzl/SourcePackages

xcodebuild -quiet \
  -project ios/PongLens/PongLens.xcodeproj \
  -scheme PongLens \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$QA_DERIVED" \
  -clonedSourcePackagesDirPath "$QA_PACKAGES" \
  -disableAutomaticPackageResolution \
  CODE_SIGNING_ALLOWED=NO \
  build-for-testing

xcrun simctl install "$QA_DEVICE" \
  "$QA_DERIVED/Build/Products/Debug-iphonesimulator/PongLens.app"

QA_DATA=$(xcrun simctl get_app_container \
  "$QA_DEVICE" com.ponglens.PongLens data)
cp /private/tmp/ponglens-scorekeeper-fixture.mp4 \
  "$QA_DATA/Documents/scorekeeper-fixture.mp4"
```

The fixture refuses to open the player when the source file is absent. It never falls back to remote media.

This runbook is for branch `codex/scorekeeper-current-app`, rooted at reconciled base `df4b36c4` with fetched current main `fd9e529c`. Before collecting evidence, confirm the branch with `git branch --show-current` and capture the current commit with `git rev-parse HEAD`; the native screenshot must show the shipped serve switch, not two separate serve balls.

## Launch cases

| Case | Launch arguments after the bundle identifier |
| --- | --- |
| Normal accepted writes, point 2 | `--qa-scorekeeper --qa-start-point 2` |
| Slow accepted writes | `--qa-scorekeeper --qa-start-point 2 --qa-delay-ms 1500` |
| Fail exactly the second requested PATCH | `--qa-scorekeeper --qa-start-point 2 --qa-fail-write 2` |
| Maximum supported delay | `--qa-scorekeeper --qa-delay-ms 30000` |

```sh
xcrun simctl launch --terminate-running-process \
  "$QA_DEVICE" com.ponglens.PongLens \
  --qa-scorekeeper --qa-start-point 2
```

`--qa-delay-ms` is clamped to 0–30000 milliseconds. `--qa-fail-write` accepts a positive one-based request ordinal, and `--qa-start-point` accepts 1–3 with point 2 as its fallback.

The current deployed playback flags are reproduced in the fixture: `tap_end_playback=on`, `keep_score_full_card=on`, `rally_end_respects_card=on`, and `unscored_rally_end=off`. A scored point therefore keeps its whole card in Keep score; fixture point 1 ends at 8.0 seconds, not the older tap-plus-guard stop at 6.5 seconds.

Dismiss the player to compare current local fields with accepted remote fields, inspect submitted/accepted/failed event order, check that unexpected requests remain zero, and reopen without resetting the model. The JSONL evidence is at `$QA_DATA/Documents/scorekeeper-qa-events.jsonl`; it is truncated at fixture process start and contains no headers or credentials.

## Focused app-host tests

The app-host test process must receive `--qa-scorekeeper`; otherwise normal startup queues are not intentionally suppressed. Copy the generated test-run file and inject the argument into the temporary copy rather than changing the shared scheme.

```sh
QA_RUN_SOURCE="$QA_DERIVED/Build/Products/PongLens_PongLens_iphonesimulator26.5-arm64-x86_64.xctestrun"
# Keep the copy beside the source: Xcode resolves __TESTROOT__ relative to it.
QA_RUN_SAFE="$QA_DERIVED/Build/Products/PongLens_QA_scorekeeper.xctestrun"

cp "$QA_RUN_SOURCE" "$QA_RUN_SAFE"
plutil -replace \
  'TestConfigurations.0.TestTargets.0.CommandLineArguments' \
  -json '["--qa-scorekeeper"]' \
  "$QA_RUN_SAFE"

xcodebuild test-without-building \
  -xctestrun "$QA_RUN_SAFE" \
  -destination "platform=iOS Simulator,id=$QA_DEVICE" \
  -only-testing:PongLensTests/ScorekeeperQAFixtureTests
```

## Mock transport contract

Only `PATCH http://127.0.0.1:54321/rest/v1/points?id=eq.<fixture-point-id>` is eligible for a 204 response. The body must contain exactly `confirmed_winner`, `is_let`, and `scored_at_cut_s`, with valid coupled values; every other target, method, query shape, field, type, or oversized body receives 403 and is never forwarded. Unexpected-event diagnostics contain only method, path, query-key names, and whether Foundation supplied body data or a body stream.
