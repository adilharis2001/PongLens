-- 028: full-match exports alongside starred exports.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
-- The Export overhaul lets a match hold TWO rendered artifacts:
--   * scope 'starred' — the existing starred-points highlight (unchanged;
--     r2 key reels/<match_id>.mp4)
--   * scope 'full'    — the whole match rendered with the scorebug, built
--     from ALL visible points in order (r2 key reels/<match_id>-full.mp4)
--
-- match_reels was one row per match (pk = match_id). It becomes one row per
-- (match_id, scope): existing rows default to 'starred', so no data moves.
-- enqueue_reel() gains a scope arg and upserts on (match_id, scope); the
-- render job carries options.scope so the worker updates the right row.
-- The manifest cap rises (a full match can run well past 200 rallies).

alter table public.match_reels
  add column scope text not null default 'starred'
  check (scope in ('starred', 'full'));

alter table public.match_reels drop constraint match_reels_pkey;
alter table public.match_reels add primary key (match_id, scope);

-- ---------------------------------------------------------------------------
-- enqueue_reel(match_id, scope, show_score, manifest) — owner-checked write
-- path. The API route validates + computes the manifest; this function only
-- re-checks ownership and shape, then queues the render job for that scope.
-- ---------------------------------------------------------------------------
drop function if exists public.enqueue_reel(uuid, boolean, jsonb);

create or replace function public.enqueue_reel(
  p_match_id uuid,
  p_scope text,
  p_show_score boolean,
  p_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_scope is null or p_scope not in ('starred', 'full') then
    raise exception 'invalid scope';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and m.user_id = auth.uid()
  ) then
    raise exception 'match not found';
  end if;
  if jsonb_typeof(p_manifest -> 'points') is distinct from 'array'
     or jsonb_array_length(p_manifest -> 'points') < 1
     or jsonb_array_length(p_manifest -> 'points') > 600 then
    raise exception 'invalid manifest';
  end if;

  insert into public.match_reels (match_id, scope, status, show_score, manifest)
  values (p_match_id, p_scope, 'queued', p_show_score, p_manifest)
  on conflict (match_id, scope) do update
    set status = 'queued',
        show_score = excluded.show_score,
        manifest = excluded.manifest,
        error = null;

  -- the jobs_enqueue trigger (001) sends the pgmq message
  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (auth.uid(), 'reel', 'queued', null, 'Match export',
          jsonb_build_object('match_id', p_match_id, 'scope', p_scope));
end;
$$;

revoke execute on function public.enqueue_reel(uuid, text, boolean, jsonb)
  from public, anon;
grant execute on function public.enqueue_reel(uuid, text, boolean, jsonb)
  to authenticated;
