-- A recap's words are data; the video file with those words burnt into it is
-- an artifact somebody asks for.
--
-- Until now the two were the same thing: correcting a typo re-encoded the
-- whole recap, because the text lives in the picture. It does not have to.
-- The apps play the clean file and draw the chapters themselves, so the
-- burnt-in file is only ever used for a download. This migration gives that
-- file its own home, its own queue and its own lease, and opens a recap to
-- somebody without a PongLens account.
--
-- The render row is a separate table rather than columns on lesson_videos
-- for one hard reason: that row carries a single lease and claim_lesson_video
-- selects work by status='queued'. A second job there would take the lease,
-- set status='processing', and canReadVideo would 404 the student who was
-- reading the recap. match_reels is the existing precedent for a rendered
-- file made for sharing, and it is a separate table for the same reason.

create table if not exists public.lesson_share_renders (
  lesson_video_id uuid primary key references public.lesson_videos(id) on delete cascade,
  owner_id        uuid not null references auth.users(id) on delete cascade,
  -- The lesson_videos.revision this file was built from. Compared against the
  -- lesson's current revision to say whether the file still matches the words.
  revision        integer not null,
  r2_key          text,
  bytes           bigint,
  status          text not null default 'queued'
                  check (status in ('queued', 'processing', 'ready', 'failed')),
  stage           text,
  error           text,
  attempts        integer not null default 0 check (attempts >= 0 and attempts <= 3),
  lease_token     uuid,
  lease_until     timestamptz,
  worker_id       text,
  release_id      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists lesson_share_renders_queue
  on public.lesson_share_renders (status, created_at);
create index if not exists lesson_share_renders_owner
  on public.lesson_share_renders (owner_id);

alter table public.lesson_share_renders enable row level security;
-- Same shape as lesson_videos: the owner reads, nobody writes through the
-- API, and anon has no grant at all.
create policy "Owners read lesson share renders"
  on public.lesson_share_renders for select to authenticated
  using (owner_id = (select auth.uid()));
revoke all on public.lesson_share_renders from anon, authenticated;
grant select on public.lesson_share_renders to authenticated;
grant all on public.lesson_share_renders to service_role;

-- Existing recaps already carry a burnt-in file that matches their words.
insert into public.lesson_share_renders (lesson_video_id, owner_id, revision, r2_key, status, stage)
select v.id, v.owner_id, v.revision, v.summary_key, 'ready', null
  from public.lesson_videos v
 where v.summary_key is not null
on conflict (lesson_video_id) do nothing;

update public.lesson_share_renders r
   set bytes = l.bytes
  from (
    select r2_key, max(bytes) as bytes
      from public.storage_ledger
     where bytes > 0
     group by r2_key
  ) l
 where r.bytes is null
   and r.r2_key is not null
   and l.r2_key = 'r2://ponglens-media/' || r.r2_key;

-- Publishing gated on the burnt-in file existing. From now on a recap may not
-- have one, so the gate moves to the file the apps actually play. Without this
-- every recap made after this change would refuse to be shared.
create or replace function public.publish_lesson_video(
  p_id uuid, p_owner uuid, p_share boolean default false
)
 returns lesson_videos
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v lesson_videos;
  lid uuid;
  note text;
begin
  select * into v from lesson_videos where id = p_id and owner_id = p_owner for update;
  if v.id is null then raise exception 'Lesson video not found'; end if;

  if v.status = 'ready' then
    if p_share then
      if v.lesson_id is not null then
        if v.student_id is not null then
          insert into coach_entries (coach_id, student_id, lesson_id, shared_at)
          values (p_owner, v.student_id, v.lesson_id, now())
          on conflict (lesson_id) do update set shared_at = now();
        else
          update lessons set shared_with_coach_at = now() where id = v.lesson_id and user_id = p_owner;
        end if;
      end if;
    end if;
    return v;
  end if;

  if v.status <> 'review' or v.playback_key is null or v.edit is null then
    raise exception 'Review the finished recap first';
  end if;
  if v.student_id is not null and not exists (
    select 1 from coach_students
     where id = v.student_id and coach_id = p_owner and archived_at is null
  ) then raise exception 'This student is no longer on your roster'; end if;
  if v.coach_ref_id is not null and not exists (
    select 1 from player_coaches
     where id = v.coach_ref_id and player_id = p_owner and archived_at is null
  ) then raise exception 'This coach is no longer on your list'; end if;

  note := nullif(btrim(coalesce(v.edit->>'title', '')), '');

  if not coalesce(v.edit->'themes', '[]'::jsonb) @> '[{"name":"Lesson video"}]'::jsonb then
    update lesson_videos set edit = jsonb_set(
      v.edit, '{themes}',
      coalesce(v.edit->'themes', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
             'name', 'Lesson video',
             'points', jsonb_build_array('Video lesson: https://ponglens.com/lesson-video/' || v.id::text)))
    ) where id = v.id returning * into v;
  end if;

  lid := v.lesson_id;
  if lid is null then
    insert into lessons (user_id, transcript, takeaways, status, kind, lesson_video_id)
    values (
      p_owner, note,
      jsonb_build_object('title', v.edit->>'title', 'themes', v.edit->'themes'),
      'ready',
      case when v.student_id is null then 'lesson' else 'coach' end,
      v.id
    )
    returning id into lid;
  else
    update lessons
       set takeaways = jsonb_build_object('title', v.edit->>'title', 'themes', v.edit->'themes'),
           lesson_video_id = v.id
     where id = lid and user_id = p_owner;
  end if;

  if p_share then
    if v.student_id is not null then
      insert into coach_entries (coach_id, student_id, lesson_id, shared_at)
      values (p_owner, v.student_id, lid, now())
      on conflict (lesson_id) do update set shared_at = now();
    else
      update lessons set shared_with_coach_at = now() where id = lid and user_id = p_owner;
    end if;
  end if;

  update lesson_videos set status = 'ready', lesson_id = lid, updated_at = now()
   where id = v.id returning * into v;
  return v;
end;
$function$;

revoke all on function public.publish_lesson_video(uuid, uuid, boolean) from public;
grant execute on function public.publish_lesson_video(uuid, uuid, boolean) to service_role;

-- A coach asking for the file. Idempotent: asking twice while one is queued
-- or building changes nothing.
create or replace function public.request_lesson_share_render(p_id uuid, p_owner uuid)
 returns public.lesson_share_renders
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v lesson_videos;
  r public.lesson_share_renders;
begin
  select * into v from lesson_videos where id = p_id and owner_id = p_owner;
  if v.id is null then raise exception 'Lesson video not found'; end if;
  if v.stage = 'Deleting' then raise exception 'This lesson is being deleted'; end if;
  if v.edit is null or v.status not in ('review', 'ready') then
    raise exception 'Review the finished recap first';
  end if;
  -- The file is cut from the clean recap, so a row that never produced one
  -- (a legacy recap, or one that has not finished) cannot make it.
  if v.playback_key is null then raise exception 'This recap has no video to work from'; end if;

  select * into r from public.lesson_share_renders where lesson_video_id = p_id for update;
  if r.lesson_video_id is not null and r.status in ('queued', 'processing') then
    return r;
  end if;

  insert into public.lesson_share_renders (lesson_video_id, owner_id, revision, status, stage, error, attempts)
  values (p_id, p_owner, v.revision, 'queued', 'Waiting to start', null, 0)
  on conflict (lesson_video_id) do update
    set revision = excluded.revision, status = 'queued', stage = 'Waiting to start',
        error = null, attempts = 0, lease_token = null, lease_until = null,
        updated_at = now()
  returning * into r;
  return r;
end;
$function$;

revoke all on function public.request_lesson_share_render(uuid, uuid) from public;
grant execute on function public.request_lesson_share_render(uuid, uuid) to service_role;

-- The worker's claim. Returns everything the render needs in one shot, so a
-- text edit landing a moment later cannot make the worker build new words and
-- stamp an old revision.
create or replace function public.claim_lesson_share_render(
  p_release text, p_worker text, p_cloud boolean default false
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  chosen uuid;
  r public.lesson_share_renders;
  v lesson_videos;
begin
  if not exists (
    select 1 from lesson_video_release
     where id = true and enabled and release_id = p_release
  ) then return null; end if;
  -- The first release runs share renders on the Mac only. The cloud
  -- dispatcher decides from queued RECAPS, and teaching it about this queue
  -- would make a coach asking for a file look like an overdue lesson.
  if p_cloud then return null; end if;

  -- A render that has failed its way through the budget stops asking.
  update public.lesson_share_renders
     set status = 'failed', stage = null, lease_token = null, lease_until = null,
         error = 'The video file could not be prepared. Try again.', updated_at = now()
   where status = 'processing' and lease_until < now() and attempts >= 3;

  select lesson_video_id into chosen
    from public.lesson_share_renders
   where status = 'queued'
      or (status = 'processing' and lease_until < now() and attempts < 3)
   order by created_at
   limit 1
     for update skip locked;
  if chosen is null then return null; end if;

  select * into v from lesson_videos where id = chosen;
  if v.id is null or v.edit is null or v.playback_key is null or coalesce(v.stage, '') = 'Deleting'
     or exists (select 1 from lesson_video_deletions d where d.owner_id = v.owner_id) then
    delete from public.lesson_share_renders where lesson_video_id = chosen;
    return null;
  end if;

  update public.lesson_share_renders
     set status = 'processing', stage = 'Preparing the video file',
         lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes',
         worker_id = p_worker, release_id = p_release, error = null,
         revision = v.revision,
         attempts = case when lesson_share_renders.status = 'processing' then lesson_share_renders.attempts + 1 else lesson_share_renders.attempts end,
         updated_at = now()
   where lesson_video_id = chosen
  returning * into r;

  return jsonb_build_object(
    'lesson_video_id', r.lesson_video_id,
    'owner_id', r.owner_id,
    'revision', r.revision,
    'lease_token', r.lease_token,
    'previous_key', r.r2_key,
    'playback_key', v.playback_key,
    'duration_s', v.duration_s,
    'edit', v.edit
  );
end;
$function$;

revoke all on function public.claim_lesson_share_render(text, text, boolean) from public;
grant execute on function public.claim_lesson_share_render(text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- The public link
-- ---------------------------------------------------------------------------

alter table public.share_links
  add column if not exists lesson_video_id uuid references public.lesson_videos(id) on delete cascade;

alter table public.share_links
  drop constraint if exists share_links_kind_check;
alter table public.share_links
  add constraint share_links_kind_check
  check (kind in ('point', 'match', 'starred', 'tag', 'entry', 'highlights', 'lesson_recap'));

alter table public.share_links
  drop constraint if exists share_links_check;
alter table public.share_links
  add constraint share_links_check
  check (
    (kind = 'point'
      and match_id is not null and point_id is not null
      and tag_id is null and lesson_id is null and lesson_video_id is null)
    or (kind in ('match', 'starred', 'highlights')
      and match_id is not null and point_id is null
      and tag_id is null and lesson_id is null and lesson_video_id is null)
    or (kind = 'tag'
      and match_id is not null and point_id is null
      and tag_id is not null and lesson_id is null and lesson_video_id is null)
    or (kind = 'entry'
      and lesson_id is not null and match_id is null
      and point_id is null and tag_id is null and lesson_video_id is null)
    or (kind = 'lesson_recap'
      and lesson_video_id is not null and lesson_id is null
      and match_id is null and point_id is null and tag_id is null)
  );

-- One active link per recap, the same rule every other target follows. The
-- create route is idempotent on top of this; the index settles races.
create unique index if not exists share_links_active_lesson_recap_uniq
  on public.share_links (lesson_video_id)
  where (kind = 'lesson_recap' and revoked_at is null);
create index if not exists share_links_lesson_video_id_idx
  on public.share_links (lesson_video_id);

drop policy if exists "Owners manage own share links" on public.share_links;
create policy "Owners manage own share links"
  on public.share_links for all
  to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid())
    and (
      (match_id is not null and exists (
        select 1 from public.matches m
        where m.id = share_links.match_id
          and m.user_id = (select auth.uid())))
      or (lesson_id is not null and exists (
        select 1 from public.lessons l
        where l.id = share_links.lesson_id
          and l.user_id = (select auth.uid())))
      or (lesson_video_id is not null and exists (
        select 1 from public.lesson_videos v
        where v.id = share_links.lesson_video_id
          and v.owner_id = (select auth.uid())))
    )
    and (point_id is null or exists (
      select 1 from public.points p
      where p.id = share_links.point_id
        and p.match_id = share_links.match_id))
    and (tag_id is null or exists (
      select 1 from public.tags t
      where t.id = share_links.tag_id
        and t.owner_id = (select auth.uid())))
  );

-- What a stranger with the link may read. Narrowed on purpose: the recap's
-- title, its chapters as they are drawn beside the video, and the keys the
-- media route will sign. No themes (the written lesson notes are the fuller
-- private record and often name how a student is struggling), no student name,
-- no owner email, no source video.
--
-- The parameter is p_token and the comparison is sl.token = p_token. A
-- parameter named `token` is shadowed by the column of that name and matches
-- every row (169).
create or replace function public.resolve_share_lesson_recap(p_token text)
returns table (
  lesson_video_id uuid,
  title text,
  owner_name text,
  chapters jsonb,
  playback_key text,
  poster_key text,
  download_key text,
  download_bytes bigint
)
language sql stable security definer set search_path = public
as $$
  select
    v.id,
    nullif(btrim(coalesce(v.edit->>'title', '')), ''),
    (select nullif(btrim(coalesce(
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'name', '')), '')
     from auth.users u where u.id = v.owner_id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', c->>'title',
        'cues', coalesce(c->'cues', '[]'::jsonb),
        'summary_start_s', c->'summary_start_s',
        'summary_end_s', c->'summary_end_s'
      ) order by ord)
      from jsonb_array_elements(coalesce(v.edit->'chapters', '[]'::jsonb)) with ordinality as t(c, ord)
    ), '[]'::jsonb),
    v.playback_key,
    regexp_replace(v.playback_key, '\.mp4$', '.jpg'),
    -- The download is offered only while the file still matches the words.
    case when r.status = 'ready' and r.revision = v.revision then r.r2_key end,
    case when r.status = 'ready' and r.revision = v.revision then r.bytes end
  from public.share_links sl
  join public.lesson_videos v on v.id = sl.lesson_video_id
  left join public.lesson_share_renders r on r.lesson_video_id = v.id
  where sl.token = p_token
    and sl.kind = 'lesson_recap'
    and sl.revoked_at is null
    and v.edit is not null
    and v.playback_key is not null
    and coalesce(v.stage, '') <> 'Deleting';
$$;

revoke execute on function public.resolve_share_lesson_recap(text) from public;
grant execute on function public.resolve_share_lesson_recap(text) to anon, authenticated;
