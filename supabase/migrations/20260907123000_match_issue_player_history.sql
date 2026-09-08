-- Player history is a safe projection, never the admin event payload.
-- Keep match_issue_state's existing access and eligibility rules unchanged.
do $$
declare v_sql text;
begin
  select pg_get_functiondef('public.match_issue_state(uuid)'::regprocedure) into v_sql;
  if position('''activeIssue'', public._match_issue_response(v_issue, v_is_owner),' in v_sql) = 0 then
    raise exception 'unexpected match_issue_state definition';
  end if;
  execute replace(v_sql,
    '''activeIssue'', public._match_issue_response(v_issue, v_is_owner),',
    '''activeIssue'', public._match_issue_response(v_issue, v_is_owner),
    ''events'', coalesce((
      select jsonb_agg(jsonb_build_object(
        ''id'', e.id, ''issueId'', e.issue_id, ''kind'', e.kind,
        ''playerNote'', e.player_note, ''createdAt'', e.created_at
      ) order by e.created_at, e.id)
      from public.match_processing_feedback_events e
      where e.issue_id = v_issue.id
    ), ''[]''::jsonb),');
end;
$$;
