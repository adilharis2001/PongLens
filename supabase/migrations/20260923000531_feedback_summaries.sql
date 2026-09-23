-- Feedback posts get a one-sentence description, and one message can
-- become several posts.
--
-- Until now the tidy step (/api/feedback/assist) only rewrote the title,
-- so the board showed whatever the author typed, typos and numbered lists
-- included, and a message asking for three things was one post that could
-- only be voted on as a whole. Now the tidy step returns one or more
-- parts, each with a title and a plain one-sentence summary. The author's
-- own words stay in `body`, untouched, and the post page shows them under
-- the summary, so nothing is put in anyone's mouth.
--
--   summary     one sentence in clean English; null on rows never tidied,
--               and every surface falls back to body when it is null.
--   split_from  set on the extra posts a split creates, pointing at the
--               post the author actually sent. Every part carries the full
--               original message as its body.

alter table public.feedback_items
  add column if not exists summary text,
  add column if not exists split_from uuid
    references public.feedback_items(id) on delete set null;

-- The board row type gains summary at the end, so clients that do not know
-- the key simply ignore it.
alter type public.feedback_board_row add attribute summary text;

create or replace function public._feedback_rows(p_item uuid, p_sort text, p_limit integer)
 returns setof public.feedback_board_row
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_admin uuid := public._qa_admin_id();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return query
  select
    i.id, i.user_id, i.title, i.body, i.type, i.status, i.qa,
    i.vote_count, i.created_at,
    public._feedback_first_name(u.*) as author_name,
    coalesce(u.raw_user_meta_data ->> 'avatar_url',
             u.raw_user_meta_data ->> 'picture') as author_avatar,
    exists (select 1 from public.feedback_votes v
            where v.item_id = i.id and v.user_id = auth.uid()) as voted,
    case when i.user_id = auth.uid() or public.is_admin()
         then i.attachments else '[]'::jsonb end as attachments,
    i.severity,
    case when i.user_id = auth.uid() or public.is_admin()
         then i.environment else null end as environment,
    i.visibility <> 'board' as hidden,
    i.comment_count,
    i.last_activity_at,
    r.body as official_reply,
    r.created_at as official_reply_at,
    i.summary
  from public.feedback_items i
  join auth.users u on u.id = i.user_id
  left join lateral (
    select c.body, c.created_at
      from public.feedback_comments c
     where c.item_id = i.id and c.user_id = v_admin
     order by c.created_at desc
     limit 1
  ) r on true
  where (p_item is null or i.id = p_item)
    and (
      i.visibility = 'board'
      or (p_item is not null and i.user_id = auth.uid())
      or (public.is_qa(i.user_id)
          and (i.user_id = auth.uid() or public.is_admin()))
    )
  order by
    case when p_sort = 'top' then i.vote_count end desc,
    case when p_sort = 'active' then i.last_activity_at end desc,
    i.created_at desc
  limit greatest(coalesce(p_limit, 200), 1);
end;
$function$;

-- Apply a tidy that may split. p_parts is an array of
-- {title, summary, type}; the first part rewrites the post the author sent,
-- every further part becomes a new post by the same author with the same
-- match, visibility and original text. Screenshots stay on the first post
-- only. Owner-only, like feedback_apply_assist. Returns the ids in order.
create or replace function public.feedback_apply_parts(
  p_item uuid,
  p_visibility text,
  p_parts jsonb
)
 returns uuid[]
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row public.feedback_items;
  v_part jsonb;
  v_ids uuid[] := array[p_item];
  v_new uuid;
  v_idx int := 0;
  v_vis text := case when p_visibility in ('board', 'private') then p_visibility end;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into v_row from public.feedback_items
   where id = p_item and user_id = auth.uid();
  if not found then
    raise exception 'item not found';
  end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then
    raise exception 'parts required';
  end if;

  for v_part in select value from jsonb_array_elements(p_parts) limit 5 loop
    v_idx := v_idx + 1;
    if v_idx = 1 then
      update public.feedback_items
         set title      = coalesce(nullif(left(trim(v_part ->> 'title'), 120), ''), title),
             summary    = nullif(left(trim(v_part ->> 'summary'), 400), ''),
             type       = case when v_part ->> 'type' in ('bug', 'idea', 'improvement', 'private')
                               then v_part ->> 'type' else type end,
             visibility = coalesce(v_vis, visibility)
       where id = p_item;
    else
      insert into public.feedback_items
        (user_id, match_id, title, summary, body, type, visibility,
         severity, environment, split_from)
      values
        (v_row.user_id, v_row.match_id,
         coalesce(nullif(left(trim(v_part ->> 'title'), 120), ''), v_row.title),
         nullif(left(trim(v_part ->> 'summary'), 400), ''),
         v_row.body,
         case when v_part ->> 'type' in ('bug', 'idea', 'improvement', 'private')
              then v_part ->> 'type' else v_row.type end,
         coalesce(v_vis, v_row.visibility),
         v_row.severity, v_row.environment, p_item)
      returning id into v_new;
      v_ids := v_ids || v_new;
    end if;
  end loop;
  return v_ids;
end;
$function$;

revoke all on function public.feedback_apply_parts(uuid, text, jsonb) from public, anon;
grant execute on function public.feedback_apply_parts(uuid, text, jsonb) to authenticated;
