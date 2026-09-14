-- The cost queries pick a price for each usage event by joining cost_rates
-- on provider/service/sku/unit and the moment the event happened. They used
-- to do that with a LATERAL ... ORDER BY effective_from DESC LIMIT 1, which
-- means "if several prices apply at once, take the newest". cost_rates holds
-- 31 rows; that defensive lookup ran once per event, 111,930 times, for
-- 744ms of every admin page load.
--
-- Two prices applying to one thing at one instant is nonsense anyway, and a
-- BEFORE INSERT OR UPDATE trigger (cost_rates_no_overlap, added earlier)
-- already rejects it. A row-level trigger cannot see an uncommitted
-- concurrent insert, so add the index-backed constraint as a backstop and
-- let both queries simply join.
create extension if not exists btree_gist with schema extensions;

alter table public.cost_rates
  drop constraint if exists cost_rates_no_overlapping_window;

alter table public.cost_rates
  add constraint cost_rates_no_overlapping_window
  exclude using gist (
    provider with =,
    service  with =,
    sku      with =,
    unit     with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  );

comment on constraint cost_rates_no_overlapping_window on public.cost_rates is
  'Backstop for the cost_rates_no_overlap trigger, which already rejects '
  'overlapping windows row by row. The trigger cannot see an uncommitted '
  'concurrent insert; this index-backed constraint can. Both must hold for '
  'the plain join in _admin_user_cost_allocation and '
  'get_platform_cost_dashboard to be safe: two rates applying at one instant '
  'would duplicate the event and double-count money.';
