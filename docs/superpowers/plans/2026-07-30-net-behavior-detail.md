# Net Behavior Detail Implementation Plan

**Goal:** Let research reviewers distinguish common post-net outcomes and describe unusual net behavior in their own words.

**Compatibility:** Preserve the existing `died_stuck_lateral` value so previously saved reviews continue to load. Add new values without changing the schema version.

## 1. Extend and test the label contract

- Add `stayed_on_table` and `rolled_off_side` to the accepted net behaviors.
- Add a `net_behavior_note` string to blank, hydrated, and cleared labels.
- Require a non-blank net behavior note only when `other` is selected.
- Test hydration, validation, and dependent-answer clearing before implementation.

## 2. Update the research interface

- Add explicit choices for “Hit the net and stayed on the table” and “Hit the net and rolled off the side.”
- Keep the existing choices for backward compatibility.
- Show a net-specific free-text field whenever “Hit the net” is selected.
- Explain that the description is optional for standard choices and required for “Another net behavior.”

## 3. Verify and release

- Run the focused research tests and production build.
- Merge the isolated branch into `main`, push, and verify the deployed research route.
