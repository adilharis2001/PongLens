# Growth round: testimonials, coach nudge, invite back, page opens

2026-08-06, overnight build. Four features, one migration (082).

## 1. Testimonials

One per order, written by the student, shown on the storefront only
when the coach chooses to show it.

**Student.** On a completed order, a quiet card: an AutoTextarea
(placeholder "What did you get out of it?"), a Send pill, and one line
under it: "May appear on {coach}'s page with your first name." Sending
is the consent. The text stays editable; editing un-features it so the
coach approves the new words.

**Coach.** A bell rings ("{student} left you a note") linking to the
completed order, where the quote sits with one toggle: "Show on your
page." No separate management screen.

**Storefront.** An eyebrow section, "From their players": up to six
featured quotes, newest first, each body + first name. Hidden when
empty.

**Data.** review_orders gains testimonial (≤500 chars), testimonial_at,
testimonial_featured. RPCs: leave_review_testimonial (student, completed
order only; re-leaving resets featured), feature_review_testimonial
(coach). coach_page v4 returns featured quotes with first names.

## 2. Free-to-paid coach nudge

Someone with no coach page who has left three or more notes on other
players' matches sees one card on the Coaching tab's player view:
"You already coach {n} players here." with Set up your page
(opens the same inline form) and a Not now pill. Not now stores a
user_metadata flag and it never returns. Replaces the generic
become-a-coach card while visible. No migration; the signal is a live
query over notes.

## 3. Invite them back

On a completed order, the coach gets one pill: "Invite them back." One
tap sends the student an email ("{coach} is ready for your next
review") linking to their order page, where Book again already lives.
Once per order: invited_back_at stamps the claim and the button becomes
a "They got an email." line. Runs through the transition API like every
other order action.

## 4. Page opens

Every storefront open by someone other than the coach inserts a row in
coach_page_views (service role; RLS lets a coach count only their own).
The coach hub's "Your page" row shows "{n} opens this week" instead of
"Published". Opens, not visitors: honest raw counts, no tracking beyond
a timestamp.

## Shared rules

Mobile first at 393×660. Pill buttons for all actions (see CLAUDE.md;
never tiny grey text). Eyebrow section headings. Copy short, direct,
kind; no em dashes; sending/tapping is the consent, explained in one
line, not a modal.
