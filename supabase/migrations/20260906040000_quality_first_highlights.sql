-- Quality-first automatic highlights.
--
-- The worker records the receipts used to admit a rally: fitted bat hits,
-- one connected run of dwell-confirmed net crossings, calibrated table
-- bounces, and an observed ending. Clients read the worker's stored manifest;
-- they do not reconstruct qualification from partial point columns.

alter table public.points
  add column if not exists highlight_evidence jsonb;

comment on column public.points.highlight_evidence is
  'Versioned worker-only evidence for automatic-highlight qualification. '
  'Null and unavailable values fail closed.';

-- Authenticated clients deliberately receive no UPDATE grant for the new
-- column. Boundary/visibility edits invalidate the old measurements in one
-- place, including SQL and native clients that do not know this column exists.
create or replace function public.points_invalidate_highlight_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.t0 is distinct from old.t0
     or new.t1 is distinct from old.t1
     or new.cut_t0 is distinct from old.cut_t0
     or new.clip_path is distinct from old.clip_path
     or new.deleted is distinct from old.deleted
     or new.edited is distinct from old.edited then
    new.highlight_evidence := null;
  end if;
  return new;
end;
$$;

drop trigger if exists points_invalidate_highlight_evidence_trigger
  on public.points;
create trigger points_invalidate_highlight_evidence_trigger
  before update of t0, t1, cut_t0, clip_path, deleted, edited
  on public.points
  for each row execute function public.points_invalidate_highlight_evidence();

-- Keep the complete live scope family from 137 and add one retained,
-- non-vertical automatic artifact.
alter table public.match_reels drop constraint match_reels_scope_check;
alter table public.match_reels add constraint match_reels_scope_check check (
  scope = any (array['starred'::text, 'full'::text, 'highlights'::text,
                     'v:starred'::text, 'v:hl:story'::text,
                     'v:hl:reel'::text, 'v:hl:long'::text])
  or scope ~ '^tag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or scope ~ '^v:point:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

alter table public.match_reels drop constraint match_reels_status_check;
alter table public.match_reels add constraint match_reels_status_check check (
  status = any (array['queued'::text, 'rendering'::text, 'ready'::text,
                      'failed'::text, 'empty'::text])
);

-- Regeneration after a point edit still uses the normal reel queue. The
-- worker ignores client membership for this scope and rebuilds from stored
-- evidence, so accepting the name here does not delegate qualification.
create or replace function public.enqueue_reel(
  p_match_id uuid, p_scope text, p_show_score boolean, p_manifest jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inflight int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_scope is null or (
    p_scope not in ('starred', 'full', 'highlights', 'v:starred',
                    'v:hl:story', 'v:hl:reel', 'v:hl:long')
    and p_scope !~ '^tag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p_scope !~ '^v:point:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'invalid scope';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and m.user_id = auth.uid()
  ) then
    raise exception 'match not found';
  end if;
  if p_scope like 'tag:%' and not exists (
    select 1 from public.tags t
    where t.id = split_part(p_scope, ':', 2)::uuid
      and t.owner_id = auth.uid()
  ) then
    raise exception 'tag not found';
  end if;
  if p_scope like 'v:point:%' and not exists (
    select 1 from public.points p
    where p.id = split_part(p_scope, ':', 3)::uuid
      and p.match_id = p_match_id
      and not p.deleted
      and p.clip_path is not null
  ) then
    raise exception 'point not found';
  end if;
  if jsonb_typeof(p_manifest -> 'points') is distinct from 'array'
     or (p_scope <> 'highlights'
         and jsonb_array_length(p_manifest -> 'points') < 1)
     or jsonb_array_length(p_manifest -> 'points') > 600 then
    raise exception 'invalid manifest';
  end if;

  select count(*) into v_inflight
    from public.jobs j
   where j.user_id = auth.uid()
     and j.kind = 'reel'
     and j.status in ('queued', 'processing')
     and coalesce(j.options ->> 'scope', '') is distinct from p_scope;
  if v_inflight >= 3 then
    raise exception 'render_queue_full' using errcode = 'P0001';
  end if;

  insert into public.match_reels (match_id, scope, status, show_score, manifest)
  values (p_match_id, p_scope, 'queued', p_show_score, p_manifest)
  on conflict (match_id, scope) do update
    set status = 'queued',
        show_score = excluded.show_score,
        manifest = excluded.manifest,
        error = null;

  if not exists (
    select 1 from public.jobs j
    where j.user_id = auth.uid()
      and j.kind = 'reel'
      and j.status in ('queued', 'processing')
      and j.options ->> 'match_id' = p_match_id::text
      and j.options ->> 'scope' = p_scope
  ) then
    insert into public.jobs (user_id, kind, status, input_path,
                             original_name, options)
    values (auth.uid(), 'reel', 'queued', null, 'Match export',
            jsonb_build_object('match_id', p_match_id, 'scope', p_scope));
  end if;
end;
$function$;

revoke execute on function public.enqueue_reel(uuid, text, boolean, jsonb)
  from public, anon;
grant execute on function public.enqueue_reel(uuid, text, boolean, jsonb)
  to authenticated;

-- Private by omission from the public app_config policy. The worker reads it
-- through the direct service connection, and the owner-facing API enforces it
-- server-side. It ships off until worker and both clients are released.
insert into public.app_config (key, value)
values ('automatic_highlights', 'off')
on conflict (key) do nothing;
