# The match analysis deck on the coach view and the share link (web, iOS build 210)

A coach opening a student's match, and anyone opening a public match or highlights link, now see the same Match analysis deck the owner has, once the match is scored and the detailed analysis has run. It is read-only there: no gate, no generate button, no flag, and the players' names where the owner reads "you". The public page carries each point's placement reduced to what the cards read, about a fifth of the record, guarded by a parity test.

## Where it shows

| Surface | Before | Now |
| --- | --- | --- |
| Web, coach opening a student's match | Result, two stat cards, serve maps section | Result, then the deck (Overview, Point length, Serve speed, Serve landings, Heat map with tappable zones, Where points ended, teaser) |
| Web, public match or highlights link | Result, two stat cards, serve maps section | Result, then the deck without the teaser and without zone taps |
| iOS, coach opening a student's match | The deck, with "you" and "Me" in the video cards | The deck, saying "the player" and "Player" |

## Checks

- `npm run build` on the shipped tree: exit 0.
- Placement suites: 119 tests pass. The new one compares the slim share record against the full one on a real 98-point match (serve maps) and on a synthetic record carrying every field a real one does (video cards).
- Headless captures of the Lester share link and of the Chris match as the coach test account, desktop and 393×660: zero occurrences of "you" in the deck, none of the owner-only cards.
- Migration `20260915160000_share_placement_table_coords` applied to production before the deploy: the share RPC's bounce list now carries table coordinates.
- Not verified by eye: the iOS coach wording (the simulator tool cannot tap; it compiles).
