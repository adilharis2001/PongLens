-- 137 — the automatic highlight scopes.
--
-- Three new vertical render scopes join the family 135 started:
--
--   v:hl:story   the picker's best rallies inside Instagram's 20s Story cap
--   v:hl:reel    the same, inside the 60s Reel cap
--   v:hl:long    the same, inside 120s — never goes through the Instagram
--                handover (its cap is 60), exists for watching, downloading
--                and every other destination
--
-- WHICH rallies is not this migration's business: the picker lives in
-- src/app/match/[id]/highlights.ts (mirrored in ios Core/Highlights.swift)
-- and the manifest it produces flows through enqueue_reel like any other.
-- The scope string carries no parameters, so one row per (match, kind) in
-- match_reels, overwritten on re-render, swept by the v:% retention tier.
--
-- Both the table CHECK and enqueue_reel's own validation must widen
-- together — 135 widened only the function first, and the INSERT was then
-- refused by the table. Both texts below are edited copies of the LIVE
-- definitions pulled from prod on 2026-08-25 (the migration files lag).

alter table public.match_reels drop constraint match_reels_scope_check;
alter table public.match_reels add constraint match_reels_scope_check check (
  scope = any (array['starred'::text, 'full'::text, 'v:starred'::text,
                     'v:hl:story'::text, 'v:hl:reel'::text, 'v:hl:long'::text])
  or scope ~ '^tag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or scope ~ '^v:point:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

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
    p_scope not in ('starred', 'full', 'v:starred',
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
     or jsonb_array_length(p_manifest -> 'points') < 1
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

  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (auth.uid(), 'reel', 'queued', null, 'Match export',
          jsonb_build_object('match_id', p_match_id, 'scope', p_scope));
end;
$function$;
