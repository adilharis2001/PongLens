alter table public.research_sources
  drop constraint if exists research_sources_media_key_check;

alter table public.research_sources
  add constraint research_sources_media_key_check
  check (
    media_key ~ '^research/(fused-labeling|placement-calibration|serve-detection|winner-constrained-endings)/v[0-9]+/sources/[0-9a-f-]{36}\.mp4$'
  );
