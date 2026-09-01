-- Add the permanent audio-impact media namespace and enforce the study's
-- development/freeze/sealed lifecycle at the database boundary.

alter table public.research_sources
  drop constraint if exists research_sources_media_key_check;

alter table public.research_sources
  add constraint research_sources_media_key_check
  check (
    media_key ~ '^research/(fused-labeling|placement-calibration|serve-detection|winner-constrained-endings|audio-impacts)/v[0-9]+/sources/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp4$'
  );

create table if not exists public.audio_impact_research_state (
  batch_id uuid primary key references public.research_batches (id) on delete cascade,
  phase text not null default 'development_a'
    check (phase in ('development_a', 'development_b', 'frozen', 'sealed_labeling', 'scored')),
  cohort_manifest_sha256 text not null check (cohort_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  detector_manifest_sha256 text check (detector_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  development_export_sha256 text check (development_export_sha256 ~ '^[0-9a-f]{64}$'),
  development_model_sha256 text check (development_model_sha256 ~ '^[0-9a-f]{64}$'),
  development_threshold_sha256 text check (development_threshold_sha256 ~ '^[0-9a-f]{64}$'),
  development_training_data_sha256 text check (development_training_data_sha256 ~ '^[0-9a-f]{64}$'),
  feature_definition_sha256 text check (feature_definition_sha256 ~ '^[0-9a-f]{64}$'),
  split_definition_sha256 text check (split_definition_sha256 ~ '^[0-9a-f]{64}$'),
  unlocked_at timestamptz,
  sealed_report_sha256 text check (sealed_report_sha256 ~ '^[0-9a-f]{64}$'),
  scored_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    phase not in ('sealed_labeling', 'scored')
    or (
      development_export_sha256 is not null
      and development_model_sha256 is not null
      and development_threshold_sha256 is not null
      and development_training_data_sha256 is not null
      and feature_definition_sha256 is not null
      and split_definition_sha256 is not null
      and unlocked_at is not null
    )
  ),
  check (
    phase <> 'scored'
    or (sealed_report_sha256 is not null and scored_at is not null)
  )
);

alter table public.audio_impact_research_state enable row level security;
revoke all on public.audio_impact_research_state from public, anon;
grant select, insert, update on public.audio_impact_research_state to authenticated;

drop policy if exists audio_impact_research_state_admin_select
  on public.audio_impact_research_state;
create policy audio_impact_research_state_admin_select
  on public.audio_impact_research_state for select
  to authenticated
  using (public.is_admin());

drop policy if exists audio_impact_research_state_admin_insert
  on public.audio_impact_research_state;
create policy audio_impact_research_state_admin_insert
  on public.audio_impact_research_state for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists audio_impact_research_state_admin_update
  on public.audio_impact_research_state;
create policy audio_impact_research_state_admin_update
  on public.audio_impact_research_state for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.validate_audio_impact_state_transition()
returns trigger
language plpgsql
as $$
begin
  if new.cohort_manifest_sha256 is distinct from old.cohort_manifest_sha256
     or new.detector_manifest_sha256 is distinct from old.detector_manifest_sha256 then
    raise exception 'frozen audio-impact manifest bindings are immutable';
  end if;
  if old.phase = 'scored' then
    raise exception 'sealed audio-impact evaluation has already been scored';
  end if;
  if new.phase is distinct from old.phase and not (
    (old.phase = 'development_a' and new.phase = 'development_b')
    or (old.phase = 'development_b' and new.phase in ('frozen', 'sealed_labeling'))
    or (old.phase = 'frozen' and new.phase = 'sealed_labeling')
    or (old.phase = 'sealed_labeling' and new.phase = 'scored')
  ) then
    raise exception 'invalid audio-impact study phase transition';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_audio_impact_state_transition_trigger
  on public.audio_impact_research_state;
create trigger validate_audio_impact_state_transition_trigger
  before update on public.audio_impact_research_state
  for each row execute function public.validate_audio_impact_state_transition();

create or replace function public.validate_audio_impact_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_slug text;
  study_phase text;
  study_round text;
  proposal_candidates jsonb;
  source_duration double precision;
  event_value jsonb;
  event_kind text;
  event_origin text;
  event_candidate_id text;
  event_time double precision;
  proposal_count int;
  matched_proposals int := 0;
begin
  select b.slug,
         state.phase,
         s.prefill->>'round',
         coalesce(s.proposal#>'{audio,candidates}', '[]'::jsonb),
         s.duration_s
    into batch_slug, study_phase, study_round, proposal_candidates, source_duration
  from public.research_sources s
  join public.research_batches b on b.id = s.batch_id
  left join public.audio_impact_research_state state on state.batch_id = b.id
  where s.id = new.source_id and b.id = new.batch_id;

  if batch_slug is distinct from 'audio-impact-labeling-recent-v1' then
    return new;
  end if;
  if study_phase is null then
    raise exception 'audio-impact study state is missing';
  end if;
  if study_round = 'B' and study_phase = 'development_a' then
    raise exception 'Round B is not unlocked';
  end if;
  if study_round = 'C' and study_phase <> 'sealed_labeling' then
    raise exception 'Round C is sealed';
  end if;
  if new.human_label is not distinct from old.human_label
     and new.status is not distinct from old.status then
    return new;
  end if;
  if study_phase in ('sealed_labeling', 'scored')
     and study_round in ('A', 'B')
     and new.human_label is distinct from old.human_label then
    raise exception 'development labels are frozen';
  end if;
  if coalesce((old.review_metrics->>'media_unavailable')::boolean, false)
     and new.human_label is distinct from old.human_label then
    raise exception 'media unavailable assignments cannot be labeled';
  end if;
  if jsonb_typeof(new.human_label) <> 'object'
     or new.human_label->>'schema_version' <> '1'
     or jsonb_typeof(new.human_label->'events') <> 'array'
     or jsonb_typeof(new.human_label->'sequence_complete') <> 'boolean' then
    raise exception 'invalid audio-impact label envelope';
  end if;
  if jsonb_typeof(proposal_candidates) <> 'array' then
    raise exception 'invalid frozen proposal candidates';
  end if;

  proposal_count := jsonb_array_length(proposal_candidates);
  for event_value in select value from jsonb_array_elements(new.human_label->'events')
  loop
    event_kind := event_value->>'kind';
    event_origin := event_value->>'origin';
    event_candidate_id := event_value->>'candidate_id';
    begin
      event_time := (event_value->>'time_s')::double precision;
    exception when others then
      raise exception 'audio-impact event time is invalid';
    end;
    if event_kind is not null and event_kind not in (
      'paddle', 'table', 'floor', 'shoe', 'net', 'background',
      'other', 'no_impact', 'unsure'
    ) then
      raise exception 'unknown audio-impact class';
    end if;
    if event_time < 0 or event_time > source_duration then
      raise exception 'audio-impact event time is outside source media';
    end if;
    if event_origin = 'proposal' then
      if event_candidate_id is null or (
        select count(*)
        from jsonb_array_elements(proposal_candidates) candidate
        where candidate->>'id' = event_candidate_id
          and abs((candidate->>'time_s')::double precision - event_time) <= 0.00011
      ) <> 1 then
        raise exception 'proposal event does not match a frozen candidate';
      end if;
      if (
        select count(*)
        from jsonb_array_elements(new.human_label->'events') duplicate_event
        where duplicate_event->>'origin' = 'proposal'
          and duplicate_event->>'candidate_id' = event_candidate_id
      ) <> 1 then
        raise exception 'proposal candidate is duplicated';
      end if;
      matched_proposals := matched_proposals + 1;
    elsif event_origin = 'manual' then
      if event_candidate_id is not null
         or coalesce(event_value->>'id', '') !~ '^manual-[0-9]+-[0-9]+$' then
        raise exception 'manual audio-impact event is invalid';
      end if;
    else
      raise exception 'unknown audio-impact event origin';
    end if;
  end loop;

  if matched_proposals <> proposal_count then
    raise exception 'every frozen candidate needs exactly one event';
  end if;
  if new.status = 'submitted' and (
    coalesce((new.human_label->>'sequence_complete')::boolean, false) is not true
    or exists (
      select 1 from jsonb_array_elements(new.human_label->'events') item
      where item->>'kind' is null
    )
  ) then
    raise exception 'submitted audio-impact labels must be complete';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_audio_impact_assignment_trigger
  on public.research_assignments;
create trigger validate_audio_impact_assignment_trigger
  before update of status, human_label, review_metrics
  on public.research_assignments
  for each row execute function public.validate_audio_impact_assignment();
