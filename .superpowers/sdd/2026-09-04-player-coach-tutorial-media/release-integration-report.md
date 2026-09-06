# Learn release integration, 2026-09-05

## Base and selection

- Integration worktree: `/Users/adil/Desktop/Projects/PongLens/.worktrees/learn-release`.
- Branch: `codex/learn-release`.
- Freshly fetched production base: `origin/main` at `ab04d037`; project build number 124.
- Selected 44 of the 46 consecutive Learn/help/tutorial commits `cb8d3458..2c80ee9f`, in original order.
- Excluded `0189e5a2` and `4613cdc7`: old PlayerTakeover/InsertGeometry compilation repairs. Current main has the newer shipped insert-seam implementation. Neither file was changed by this integration.
- No earlier coach, landing-page, worker or research branch commits were merged. Coach prerequisites already exist on current main, largely as patch-equivalent commits.
- Navigation fix `e59c0587` was cherry-picked as `c2ca6a1f`.

## Resolved conflicts

- `src/app/learn/guides.ts` and `videos/chapters.ts`: replace obsolete inline arrays with the new role-aware catalog adapters. Current main's Score the Match wording was then restored in the new catalog.
- `ios/.../Resources/guides.json`: remove the obsolete file in favor of the generated `learn-catalog.json`.
- `LearnScreen.swift`: use the new audience-filtered catalog rather than the old inline chapter array.
- `StudentView.tsx`: retain current main's Waiting/shared states, bulk sharing, shared student journal, and score display. Add only the selected match-linking implementation and its rollback handling.

## Current-main content corrections

- `ee3157dd`: use Score the Match in the player guide, chapter catalog, narration manifest/script, and capture selectors; preserve the `keepscore` and `score-keeper` identifiers. Generated voice timing/audio is intentionally not fabricated. The affected video must be regenerated before final media verification.
- `59f669d5` and `ba3050a7`: explain sharing before a student joins, Waiting, delivery on connection, and the invite panel's bulk share action. Use the current Share control label. This is bulk share only, not bulk unshare.
- Existing coach share-video wording remains a true high-level explanation; it does not need to list every recent addition. The iOS entry-detail screen still uses Share with, while cards use Share.

## Verification and remaining release work

- Integrated Learn tests: 36 passed.
- Integrated tutorial pipeline tests: 112 passed.
- Entry-match authorization/rollback tests: 11 passed.
- Generated iOS catalog parity: passed.
- Real `npm run build` at `c2ca6a1f`: passed, including complete type checking, 144 generated pages and build traces. Existing lint warnings remain.
- Integrated iOS simulator XCTest baseline at `c2ca6a1f`: passed on iPhone 17 Pro / iOS 26.5, using `/tmp/ponglens-learn-release-derived`.
- Related-guide audit found that direct `guide:<slug>` entry bypassed the LearnScreen-only typed route registration. The shared registrar now owns `LearnGuide` destinations and LearnScreen's duplicate registration is removed. The new regression failed before the change (XCTest exit 65); the complete integrated suite then passed 33/33 (exit 0).
- Final XCTest evidence: `/tmp/ponglens-learn-release-derived/Logs/Test/Test-PongLens-2026.09.05_06-24-41--0400.xcresult`. This compiles the complete simulator app and executes the Learn catalog/navigation/lifecycle tests. Live screen taps and production playback remain a separate release verification responsibility.
- No push, deployment, TestFlight archive or upload was performed by this integration agent. App Store Connect build availability was not queried; 124 is the remote project's build number, not an assertion about the next free number.
