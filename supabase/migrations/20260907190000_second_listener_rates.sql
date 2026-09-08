-- The second listener. A stretch the first one came back empty on is put
-- to a model with ears, and the two answers together say whether nobody
-- spoke or nobody was heard. It is billed by token rather than by the
-- minute, and audio input is the part that counts: about twelve tokens a
-- second of audio, against roughly a hundred and twenty-five output
-- tokens for a sixty-second piece.
insert into cost_rates (provider, service, sku, unit, price_per_unit_usd, included_units, effective_from, source_url, source_label)
values
  ('OpenAI', 'Audio', 'gpt-audio', 'audio_input_token', 0.000032, 0, timestamptz '2026-09-07 00:00:00+00',
   'https://developers.openai.com/api/docs/pricing.md', '$32.00 per 1M audio input tokens'),
  ('OpenAI', 'Audio', 'gpt-audio', 'input_token', 0.0000025, 0, timestamptz '2026-09-07 00:00:00+00',
   'https://developers.openai.com/api/docs/pricing.md', '$2.50 per 1M text input tokens'),
  ('OpenAI', 'Audio', 'gpt-audio', 'output_token', 0.00001, 0, timestamptz '2026-09-07 00:00:00+00',
   'https://developers.openai.com/api/docs/pricing.md', '$10.00 per 1M output tokens')
on conflict do nothing;
