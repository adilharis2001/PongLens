# Match analysis is one swiping deck: build 208

Released September 15, 2026 from `88b4f99c` on main (web PRs #4 and #6,
iOS PR #5; the research record followed in #7).

- Once 75% of a match's scoreable points carry a winner, the same integer
  rule the highlights use, the Match analysis deck adds four cards read
  from data the worker already stored: point length by whose serve, serve
  speed from the serve's two bounces, serve variety, and where points
  ended. Each says how many points it stands on.
- The serve maps are two cards of the same deck (Landings, Heat map), the
  Beta chip rides on every card the ball engine feeds, and the Tools card
  has one "Match analysis" row whose status names what the section is
  waiting on. Generating maps is a card where the maps will be.
- One swiping deck on every surface: one card per screen on the phone and
  in the app, two per view on desktop with arrow buttons, dots under all
  three. Below the bar, one card says how many points are scored and how
  many the bar asks for; the deck ends on "More match analysis cards
  coming soon."
- Web: a heat-map zone opens the list of its points; a point opened that
  way gets a "Back to match analysis" pill. Not on iOS yet.
- Not built, and why: receive errors, third-ball outcomes, rally length in
  shots and attack-versus-push. Measured on 19 scored matches, the
  return-of-serve bounce is missed on half the points that show none.
  `docs/research/2026-09-15-scored-match-cards/`.
- Verified: production web build on the shipped tree; placement suite 112
  tests; `ios/Tests/run.sh` 1,171 checks green including the new
  scored-cards group; desktop and 393×660 web screenshots on the Chris
  22 Aug match; iOS simulator build succeeds. The iOS deck was not
  walked through on a simulator by the agent (the live-panel bridge kept
  crashing and the owner's first-run age screen stood in the way).
- App Store Connect accepted iOS version 1.0 build 208 for processing
  (upload succeeded 10:25 EDT).

Archive: `/private/tmp/pl-scored-cards-208.xcarchive`.
Archive log: `/private/tmp/ponglens-scored-cards-archive2.log`.
Upload log: `/private/tmp/ponglens-scored-cards-upload.log`.
