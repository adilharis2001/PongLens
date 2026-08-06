# Coaching tab: visibility contract + "From your coaches"

2026-08-06. Spec only; no code yet.

## 1. Visibility contract (confirming, not changing)

The Coaching tab appears when ANY of these become true, and never leaves:

- you created a coach page (coach_profiles row)
- players share matches with you (accepted coach_links as coach)
- **you invited a coach** (coach_links as player, pending or accepted —
  the invite itself is the moment coaching enters your life)
- you bought a review (any review_orders row as student)

This is already what ships today. The only decision being ratified: the
tab is relationship-triggered, not role-triggered, and the trigger for a
player is the FIRST INVITE, not the coach's acceptance.

## 2. Where "Add a coach" lives for someone with no tab yet

Nowhere new, and not back in Account. The first invite has always
happened where the intent occurs: on a match (Tools → Coach) and in the
share sheet ("With your coach"). That flow creates the link row, which
makes the tab appear — the tab is the *result* of adding a coach, never
the prerequisite. Account stays clean.

One cheap reinforcement (small, separate change): a "Share a match with
your coach" item in the existing first-steps checklist, derived from
product state like its siblings (done when any coach_links row exists).

## 3. "From your coaches" — the new block on the Coaching tab

What it answers: "what have my coaches told me lately, and where?"
The Journal remains the archive of everything; this is the coaching lens.

**Data.** The existing note_feed() RPC (has_match_access-scoped,
authorship included). Client filters to notes on MY matches whose author
is not me. No new tables, no new RPCs.

**Shape.** One card group per match, newest activity first, capped at 3
matches and 2 notes each. Each note: author name (amber, the coach
accent), first ~2 lines of body, time-ago. Each group: the match title
line and one "Open the match" link deep-linking to the newest note's
point (?p=<point_id> — plumbing exists). A voice or drawing note renders
its type glyph, not the media; playback happens on the match.

**Placement.** Player side of the tab, in this order:
1. From your coaches   (new; hidden when empty)
2. Reviews you bought  (existing)
3. Your coaches        (existing)
Coach-workspace sections stay above all three for coaches.

**Empty states.** Hidden entirely when there are no coach notes. No
placeholder copy.

**Not in scope.** Read receipts on free notes, note replies from this
surface, pagination (the Journal already holds the full history).

## 4. Order of work

1. Coaching tab: add the From-your-coaches block (client filter over
   note_feed, group + cap + deep links).
2. First-steps checklist: "Share a match with your coach" item.
3. Verify at 393×660, ship, watch the deployment to READY.
