-- Keep acoustically distinct foot sounds separate throughout audio-impact review.
-- This replaces only the assignment validator; all lifecycle guards from 152 stay intact.

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
  event_id text;
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
  if study_phase = 'scored' then
    raise exception 'frozen audio-impact assignments are read-only';
  end if;
  if study_round = 'C' and study_phase <> 'sealed_labeling' then
    raise exception 'Round C is sealed';
  end if;
  if new.human_label is not distinct from old.human_label
     and new.status is not distinct from old.status then
    return new;
  end if;
  if study_phase in ('frozen', 'sealed_labeling', 'scored')
     and study_round in ('A', 'B')
     and (
       new.human_label is distinct from old.human_label
       or new.status is distinct from old.status
     ) then
    raise exception 'frozen audio-impact assignments are read-only';
  end if;
  if (
       coalesce((old.review_metrics->>'media_unavailable')::boolean, false)
       or coalesce((new.review_metrics->>'media_unavailable')::boolean, false)
     ) and (
       new.human_label is distinct from old.human_label
       or new.status is distinct from old.status
     ) then
    raise exception 'media unavailable assignments cannot be labeled';
  end if;
  if jsonb_typeof(new.human_label) <> 'object'
     or new.human_label->>'schema_version' <> '1'
     or jsonb_typeof(new.human_label->'events') is distinct from 'array'
     or jsonb_typeof(new.human_label->'sequence_complete') is distinct from 'boolean' then
    raise exception 'invalid audio-impact label envelope';
  end if;
  if jsonb_typeof(proposal_candidates) <> 'array' then
    raise exception 'invalid frozen proposal candidates';
  end if;

  proposal_count := jsonb_array_length(proposal_candidates);
  for event_value in select value from jsonb_array_elements(new.human_label->'events')
  loop
    if jsonb_typeof(event_value) is distinct from 'object' then
      raise exception 'audio-impact event must be an object';
    end if;
    event_id := event_value->>'id';
    event_kind := event_value->>'kind';
    event_origin := event_value->>'origin';
    event_candidate_id := event_value->>'candidate_id';
    if coalesce(event_id, '') = ''
       or jsonb_typeof(event_value->'time_s') is distinct from 'number'
       or jsonb_typeof(event_value->'origin') is distinct from 'string'
       or (
         event_value ? 'kind'
         and jsonb_typeof(event_value->'kind') not in ('string', 'null')
       ) then
      raise exception 'audio-impact event has missing or invalid fields';
    end if;
    if (
      select count(*) from jsonb_array_elements(new.human_label->'events') duplicate_event
      where duplicate_event->>'id' = event_id
    ) <> 1 then
      raise exception 'audio-impact event ID is duplicated';
    end if;
    begin
      event_time := (event_value->>'time_s')::double precision;
    exception when others then
      raise exception 'audio-impact event time is invalid';
    end;
    if event_kind is not null and event_kind not in (
      'paddle', 'table', 'floor', 'shoe', 'shoe_squeak', 'stomp',
      'net', 'background', 'other', 'no_impact', 'unsure'
    ) then
      raise exception 'unknown audio-impact class';
    end if;
    if event_time is null
       or event_time in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
       or event_time < 0 or event_time > source_duration then
      raise exception 'audio-impact event time is outside source media';
    end if;
    if event_origin = 'proposal' then
      if event_candidate_id is null or event_id <> event_candidate_id or (
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
