-- The lesson transcription ladder's rungs, so the ledger prices what the
-- worker actually calls. Deepgram keeps its rows: it still transcribes
-- journal voice notes, it has thirty days of lesson history to reconcile,
-- and closing a rate would make that history unpriceable.
insert into cost_rates (provider, service, sku, unit, price_per_unit_usd, included_units, effective_from, source_url, source_label)
values (
  'OpenAI', 'Transcription', 'whisper-1', 'audio_second',
  0.0001, 0, timestamptz '2026-09-07 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing.md',
  '$0.006 per minute'
)
on conflict do nothing;
