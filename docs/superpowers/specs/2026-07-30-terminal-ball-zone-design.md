# Terminal Ball Zone Design

## Problem

The rally-details prompt, “Where did the final ball reach the receiving player?”, assumes the terminal ball reached a meaningful receiving-player location. That assumption is false when the ball hits the net or goes out, and “Unknown” currently conflates “not applicable” with “the reviewer could not tell.”

## Design

Keep the existing `receiving_zone` field and schema version, but extend its accepted values with `not_applicable`. Display the prompt as:

> Where did the final ball go relative to the receiving player?

Display these answers:

- `forehand` — Forehand
- `backhand` — Backhand
- `middle` — Middle / body
- `not_applicable` — No receiving zone — hit the net or went out
- `unknown` — Couldn’t tell

The answer remains optional research detail. The UI will not select `not_applicable` automatically based on the ending family because some net clips continue forward and some long or wide balls still reveal useful lateral placement.

## Compatibility and Data Flow

Existing stored values continue to hydrate unchanged. New reviews autosave `not_applicable` inside the existing JSON human label and therefore appear in the existing export without a database migration.

Winner corrections continue resetting this dependent field to `unknown`, matching existing behavior.

## Verification

Add a contract test proving `not_applicable` hydrates successfully and remains distinct from `unknown`. Add a route contract check for the revised reviewer-facing wording, then run the research suite and production build.
