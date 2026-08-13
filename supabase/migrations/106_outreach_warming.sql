-- 106: warming, and the third kind of person worth writing to.
--
-- The research says the first move in a cold Instagram DM is not a message.
-- Following someone and engaging with their posts for three to five days
-- before writing reportedly lifts delivery 40 to 50%, and a DM carrying a
-- mutual signal converts at 8 to 15% against low single digits cold. That
-- is a real stage a coach sits in for days, so it belongs in the pipeline
-- rather than in a note somewhere.
--
-- 'pro' joins coach and club because a well known player with their own
-- coaching page is a different conversation from a club coach: they are not
-- looking for students and they are not short of an audience, so the offer
-- is the interface rather than the marketplace.

alter table public.outreach_coaches
  drop constraint outreach_coaches_stage_check;

alter table public.outreach_coaches
  add constraint outreach_coaches_stage_check
  check (stage in ('found', 'qualified', 'ready', 'warming', 'contacted',
                   'replied', 'not_a_fit', 'no_reply', 'signed_up',
                   'do_not_contact'));

alter table public.outreach_coaches
  drop constraint outreach_coaches_entity_type_check;

alter table public.outreach_coaches
  add constraint outreach_coaches_entity_type_check
  check (entity_type in ('coach', 'club', 'pro', 'unknown'));

-- When the warming started, so the page can say how many days in they are
-- rather than making Adil remember. Set when the stage becomes 'warming'.
alter table public.outreach_coaches
  add column warming_since timestamptz;

create or replace function public.outreach_stamp_warming()
returns trigger
language plpgsql
as $$
begin
  if new.stage = 'warming' and old.stage is distinct from 'warming' then
    new.warming_since := now();
  elsif new.stage <> 'warming' then
    new.warming_since := null;
  end if;
  return new;
end;
$$;

create trigger outreach_coaches_stamp_warming
  before update on public.outreach_coaches
  for each row execute function public.outreach_stamp_warming();
