-- Duration-based estimate for the lesson fallback. The provider actually bills
-- tokens; its public estimated rate is $0.006/minute ($0.0001/audio_second).
insert into public.cost_rates(provider,service,sku,unit,price_per_unit_usd,effective_from,source_url,source_label)
select 'OpenAI','Transcription','gpt-4o-transcribe-diarize','audio_second',0.0001,
 '2026-09-05T00:00:00Z','https://developers.openai.com/api/docs/pricing.md',
 'Estimated $0.006/min; actual model billing is token-based'
where not exists(select 1 from public.cost_rates where provider='OpenAI'
 and service='Transcription' and sku='gpt-4o-transcribe-diarize'
 and unit='audio_second' and effective_to is null);
