-- 108: the first message asks permission, and the funnel goes further.
--
-- The outreach approach changed. Message one no longer explains PongLens
-- at all: it says who he is and asks whether he may send what he is
-- building. The explanation and the link are message two, once they have
-- answered. A full pitch in a first DM is what five thousand founder
-- messages look like, and the objective of the first one is a reply.
--
-- Two things follow from that.
--
-- personal_note is the real detail he noticed, typed by him. It cannot be
-- generated. A specific compliment invented by a machine is precisely the
-- thing that reads as fake now, so the column is empty until a person puts
-- something true in it, and the message does without when it is.
--
-- 'trialling' is the stage the whole exercise is aimed at. The funnel that
-- matters is sent, replied, tried it with a student, used it again, and
-- until now the pipeline stopped at replied. A coach who tried it with one
-- student and came back for a second is the signal worth more than every
-- reply rate on the page.

alter table public.outreach_coaches
  add column personal_note text;

comment on column public.outreach_coaches.personal_note is
  'Something real he noticed about them, in his words, for the first
   message. Never generated: an invented detail is worse than none.';

alter table public.outreach_coaches
  drop constraint outreach_coaches_stage_check;

alter table public.outreach_coaches
  add constraint outreach_coaches_stage_check
  check (stage in ('found', 'qualified', 'ready', 'warming', 'contacted',
                   'replied', 'trialling', 'not_a_fit', 'no_reply',
                   'signed_up', 'do_not_contact'));

-- Which message a touch was, so the history reads as a conversation rather
-- than a pile of outbound text, and so the page knows what to offer next.
alter table public.outreach_touches
  add column message_kind text
  check (message_kind is null or message_kind in ('first', 'second', 'followup'));

-- Everything written before this was the old single long message, which is
-- the first thing he sent them.
update public.outreach_touches
   set message_kind = 'first'
 where direction = 'out' and message_kind is null;
