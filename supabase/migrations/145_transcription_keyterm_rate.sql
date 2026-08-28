-- Price for Deepgram keyterm prompting, the paid nova-3 add-on that carries
-- the table-tennis vocabulary in /api/transcribe. Without a rate row the
-- add-on meters fine, finds no price and lands in the dashboard's unmapped
-- bucket reading $0 — indistinguishable from free, which is the exact silent
-- failure the model-rate test in costMigration.test.ts exists to catch.
--
-- It is its own sku rather than a bumped nova-3 rate because Deepgram bills
-- it that way: $0.0013 per minute on top of the $0.0077 per minute model. So
-- the base rate stays equal to Deepgram's published price for nova-3, and
-- what the accuracy work costs stays a number someone can read.
--
-- 0.0013 / 60 = 0.0000216666666666667 per audio second.
--
-- Forward-only and safe to re-run: fresh databases and existing projects both
-- end up with the same single row.

insert into public.cost_rates (
  provider, service, sku, unit, price_per_unit_usd, included_units,
  effective_from, source_url, source_label
) values
  ('Deepgram', 'Transcription', 'nova-3-keyterm', 'audio_second',
   0.0000216666666666667, 0, '2026-08-27T00:00:00Z',
   'https://deepgram.com/pricing',
   'Deepgram keyterm prompting add-on, 2026-08-27')
on conflict (provider, service, sku, unit, effective_from)
do update set
  price_per_unit_usd = excluded.price_per_unit_usd,
  included_units = excluded.included_units,
  source_url = excluded.source_url,
  source_label = excluded.source_label;
