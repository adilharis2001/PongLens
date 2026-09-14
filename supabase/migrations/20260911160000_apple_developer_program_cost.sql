-- The Apple Developer Program, which PongLens cannot ship an iOS build
-- without. $99 a year is Apple's published price for the individual and
-- organization programs; the date is the start of development that Adil
-- gave on 2026-09-11 rather than a membership receipt, so the note says
-- so and the Building tab lets him correct it without a migration.
--
-- Entered as the annual figure on purpose. monthly_cost_usd derives from
-- it, so nobody has to remember that the page wants a twelfth.
insert into public.cost_fixed_items (
  provider, label, amount_usd, recurrence, category,
  effective_from, enabled, note
)
select 'Apple', 'Developer Program', 99, 'annual', 'build',
       date '2026-07-11', true,
       'Apple''s published price; start date assumed, correct it if the membership is older'
where not exists (
  select 1 from public.cost_fixed_items
  where provider = 'Apple' and label = 'Developer Program'
);
