-- 042: cross-match tag reels — one rendered export per TAG, cutting the
-- tagged points together across every match ("all my backhand errors
-- this season"). Mirrors match_reels but keyed by the tag: the reel has
-- no home match, so it gets its own row and its own r2 key.
--
--  * tag_reels — one row per tag (owner via user_id; the tag row itself
--    is owner-keyed too). Client reads status; only the RPC + worker
--    write.
--  * enqueue_tag_reel(tag_id, manifest) — owner-checked write path; the
--    API route computes the manifest (point clips across matches, no
--    scorebug: a cross-match score would be incoherent). Queues a 'reel'
--    job whose options carry tag_id INSTEAD of match_id — the worker
--    branches on that.

create table public.tag_reels (
  tag_id     uuid primary key references public.tags (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'queued'
             check (status in ('queued', 'rendering', 'ready', 'failed')),
  manifest   jsonb,
  r2_key     text,
  duration_s numeric,
  size_bytes bigint,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tag_reels enable row level security;
create policy "Owners read own tag reels"
  on public.tag_reels for select
  to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.tag_reels from anon;
grant select on public.tag_reels to authenticated;

create function public.enqueue_tag_reel(p_tag_id uuid, p_manifest jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.tags t
    where t.id = p_tag_id and t.owner_id = auth.uid()
  ) then
    raise exception 'tag not found';
  end if;
  if jsonb_typeof(p_manifest -> 'points') is distinct from 'array'
     or jsonb_array_length(p_manifest -> 'points') < 1
     or jsonb_array_length(p_manifest -> 'points') > 200 then
    raise exception 'invalid manifest';
  end if;

  insert into public.tag_reels (tag_id, user_id, status, manifest)
  values (p_tag_id, auth.uid(), 'queued', p_manifest)
  on conflict (tag_id) do update
    set status = 'queued',
        manifest = excluded.manifest,
        error = null,
        updated_at = now();

  -- the jobs_enqueue trigger (001) sends the pgmq message
  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (auth.uid(), 'reel', 'queued', null, 'Tag reel',
          jsonb_build_object('tag_id', p_tag_id));
end;
$$;

revoke execute on function public.enqueue_tag_reel(uuid, jsonb)
  from public, anon;
grant execute on function public.enqueue_tag_reel(uuid, jsonb)
  to authenticated;
