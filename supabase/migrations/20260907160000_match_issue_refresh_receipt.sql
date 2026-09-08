-- Only public state needed to refresh active footage and prove a failed-job
-- reversal. Ledger notes and billing facts remain private to the server.
create or replace function public.match_issue_state(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_match public.matches%rowtype;
  v_issue public.match_processing_feedback%rowtype;
  v_is_owner boolean;
  v_minutes integer := 0;
  v_refund jsonb;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.has_match_access(p_match_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  v_is_owner := v_match.user_id = v_me;
  if v_is_owner then
    v_minutes := public._match_issue_refundable_minutes(v_match.user_id, v_match.id, v_match.job_id);
    if v_match.status = 'failed' then
      -- Bigint ledger IDs are decimal strings on every client, never JSON
      -- numbers (which lose precision in JavaScript) or UUIDs.
      select jsonb_build_object('minutes', sum(r.minutes), 'receiptIds', jsonb_agg(r.id::text order by r.created_at, r.id))
      into v_refund
      from public.processing_ledger r join public.processing_ledger s on s.id = r.reverses_id
      where r.user_id = v_me and r.match_id = v_match.id and r.job_id = v_match.job_id
        and r.kind = 'refund' and r.funding = 'personal' and r.minutes > 0
        and r.note = 'processing failed' and s.kind = 'spend'
        and s.user_id = v_me and s.match_id = v_match.id and s.job_id = v_match.job_id
        and r.minutes = -s.minutes
      having count(*) > 0;
    end if;
  end if;
  select * into v_issue from public.match_processing_feedback
    where match_id = p_match_id and reporter_id = v_me order by created_at desc limit 1;
  return jsonb_build_object(
    'role', case when v_is_owner then 'owner' else 'coach' end,
    'matchStatus', v_match.status,
    'activeProcessingVersionId', v_match.active_processing_version_id,
    'automaticRefund', v_refund,
    'activeIssue', public._match_issue_response(v_issue, v_is_owner),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'issueId', e.issue_id, 'kind', e.kind,
      'playerNote', e.player_note, 'createdAt', e.created_at
    ) order by e.created_at, e.id) from public.match_processing_feedback_events e where e.issue_id = v_issue.id), '[]'::jsonb),
    'refundableMinutes', case when v_is_owner then v_minutes else null end,
    'canPositive', v_is_owner and v_match.status = 'ready',
    'canProblem', true,
    'canReprocess', v_is_owner and v_match.status = 'ready' and public.match_reprocess_source(p_match_id) is not null,
    'canRefund', v_is_owner and v_match.status = 'ready' and v_minutes > 0
  );
end;
$$;
revoke all on function public.match_issue_state(uuid) from public, anon;
grant execute on function public.match_issue_state(uuid) to authenticated;
