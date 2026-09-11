-- Apply this guard after the API that maps highlights_score_required to the
-- owner-facing score prompt is live. Rewriting the live definition preserves
-- every scope and the processing-version checks added by earlier migrations.

do $$
declare
  definition text;
  guarded_definition text;
begin
  definition := pg_get_functiondef(
    'public.enqueue_reel(uuid,text,boolean,jsonb)'::regprocedure
  );

  if position('highlights_score_required' in definition) > 0 then
    return;
  end if;

  -- This insertion point follows enqueue_reel's authentication and
  -- "match not found" owner check and precedes manifest validation.
  guarded_definition := replace(
    definition,
    E'  if jsonb_typeof(p_manifest -> ''points'') is distinct from ''array''',
    E'  if p_scope = ''highlights'' and not coalesce((\n'
      || E'    select h.eligible\n'
      || E'      from public.highlight_generation_eligibility(p_match_id) h\n'
      || E'  ), false) then\n'
      || E'    raise exception ''highlights_score_required'' using errcode = ''P0001'';\n'
      || E'  end if;\n'
      || E'  if jsonb_typeof(p_manifest -> ''points'') is distinct from ''array'''
  );

  if guarded_definition = definition then
    raise exception 'match not found before highlights_score_required guard insertion point';
  end if;

  execute guarded_definition;
end;
$$;
