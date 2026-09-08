-- Migrations 20260907130000 and 20260907140000 adapt established RPCs with
-- pg_get_functiondef so each deployed database keeps its exact signature and
-- grants. Those rewrites deliberately fail here if an older environment had a
-- different function body and therefore missed a required safety boundary.
do $$
declare
  r record;
  definition text;
begin
  for r in
    select * from (values
      ('adjust_point(uuid,numeric,numeric,boolean,boolean,numeric,numeric)', 'require_active_point'),
      ('split_point(uuid,numeric,numeric)', 'require_active_point'),
      ('unsplit_point(uuid,uuid,numeric,boolean,boolean)', 'require_active_point'),
      ('insert_point(uuid,uuid,numeric,numeric,numeric)', 'require_active_point'),
      ('merge_points(uuid[])', 'require_active_point'),
      ('set_server_override(uuid,text)', 'require_active_point'),
      ('enqueue_reel(uuid,text,boolean,jsonb)', 'require_active_reel_manifest'),
      ('enqueue_tag_reel(uuid,jsonb)', 'require_active_reel_manifest'),
      ('resolve_share_points(text)', 'active_point_version'),
      ('resolve_share_removed(text)', 'active_point_version'),
      ('resolve_share_starred(text)', 'active_point_version'),
      ('resolve_share_tagged(text)', 'active_point_version'),
      ('resolve_share_placement(text)', 'active_point_version'),
      ('starred_points()', 'active_point_version'),
      ('resolve_share_link(text)', 'match_processing_versions pv'),
      ('match_issue_state(uuid)', 'match_reprocessing_enabled'),
      ('sync_active_match_processing_version()', 'v_sync_provenance'),
      ('admin_upload_detail(uuid)', 'active_match_points'),
      ('admin_match_points(uuid)', 'active_match_points'),
      ('admin_point_evidence(uuid)', 'active_match_points'),
      ('admin_recent_uploads(integer,uuid)', 'active_match_points'),
      ('admin_player_detail(uuid)', 'active_match_points'),
      ('admin_player_overview()', 'active_match_points')
    ) expected(signature, marker)
  loop
    if to_regprocedure('public.' || r.signature) is null then
      raise exception 'match version migration postcondition failed: missing %', r.signature;
    end if;
    definition := pg_get_functiondef(to_regprocedure('public.' || r.signature));
    if position(r.marker in definition) = 0 then
      raise exception 'match version migration postcondition failed: % lacks %', r.signature, r.marker;
    end if;
  end loop;
end $$;

do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.admin_match_issue_list(text)'::regprocedure);
  if position('_match_issue_refundable_minutes' in definition) = 0 then
    raise exception 'match admin migration postcondition failed: list amount';
  end if;

  definition := pg_get_functiondef('public.admin_refund_match_issue(uuid,text,text)'::regprocedure);
  if position('candidate_ready' in definition) = 0
    or position('execution_failed' in definition) = 0
    or position('reverses_id' in definition) = 0 then
    raise exception 'match admin migration postcondition failed: refund states';
  end if;

  definition := pg_get_functiondef('public.admin_start_match_reprocess(uuid,jsonb,text)'::regprocedure);
  if position('previous run has not failed' in definition) = 0
    or position('unsupported option' in definition) = 0
    or position('strictness' in definition) = 0
    or position('placement' in definition) = 0 then
    raise exception 'match admin migration postcondition failed: retry options';
  end if;
end $$;
