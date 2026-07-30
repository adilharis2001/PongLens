-- Forward-only production patch for cost rates added after migration 050 was
-- first deployed. Safe both for existing projects and fresh databases that
-- already received the final 050 seed rows.

update public.cost_rates
set effective_from = '2026-01-01T00:00:00Z'
where effective_from = '2026-07-29T00:00:00Z'
  and source_label like '%2026-07-29%';

insert into public.cost_rates (
  provider, service, sku, unit, price_per_unit_usd, included_units,
  effective_from, source_url, source_label
) values
  ('Cloudflare', 'R2', 'r2-standard', 'storage_byte_snapshot',
   0, 0, '2026-01-01T00:00:00Z',
   'https://developers.cloudflare.com/r2/platform/metrics-analytics/',
   'R2 byte snapshot is informational; daily GB-month accrual is priced'),
  ('OpenAI', 'AI', 'gpt-5.6-sol', 'input_token',
   0.000005, 0, '2026-07-01T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
   'OpenAI GPT-5.6 Sol pricing, 2026-07-29'),
  ('OpenAI', 'AI', 'gpt-5.6-sol', 'cached_input_token',
   0.0000005, 0, '2026-07-01T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
   'OpenAI GPT-5.6 Sol pricing, 2026-07-29'),
  ('OpenAI', 'AI', 'gpt-5.6-sol', 'output_token',
   0.00003, 0, '2026-07-01T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
   'OpenAI GPT-5.6 Sol pricing, 2026-07-29')
on conflict (provider, service, sku, unit, effective_from)
do update set
  price_per_unit_usd = excluded.price_per_unit_usd,
  included_units = excluded.included_units,
  source_url = excluded.source_url,
  source_label = excluded.source_label;
