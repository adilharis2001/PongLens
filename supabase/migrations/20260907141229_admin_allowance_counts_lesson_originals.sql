-- The storage-counting rule is written down twice: once in
-- my_storage_state, which decides whether a player may upload, and once
-- here, which is the page an admin opens to answer the request that
-- refusal produces. Adding lesson-video originals to the first and not
-- the second left them 11.6 GB apart on the one account that has any, so
-- an admin would have seen a player comfortably under a limit that had
-- just turned them away.
--
-- This is the defect CLAUDE.md calls "a rule written down twice, wrong
-- the same way in both" — except here it was wrong in only one, which is
-- worse, because the two disagree in a way nothing surfaces.

create or replace function public.admin_allowance_players(p_search text default ''::text)
 returns table(
   user_id uuid, email text, name text, minutes_balance integer,
   storage_limit_bytes bigint, used_bytes bigint
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query select u.id, u.email::text, public._display_name(u.*),
    public._processing_balance(u.id, case when public.is_qa(u.id) then 'test' else 'live' end) +
      case when exists (select 1 from public.processing_ledger l where l.user_id = u.id
        and l.kind = 'grant' and l.billing_mode = case when public.is_qa(u.id) then 'test' else 'live' end)
      then 0 else public._commerce_int('free_processing_minutes', 250) end,
    coalesce(q.storage_limit_bytes, public.default_storage_bytes()) +
      coalesce((select sum(e.bytes) from public.storage_entitlements e where e.user_id = u.id
        and e.expires_at > now()), 0)::bigint,
    greatest(coalesce((select sum(l.bytes) from public.storage_ledger l
      left join public.review_orders o on o.id = l.order_id
      where l.user_id = u.id
        and (l.r2_key like 'r2://ponglens-raw/%'
             or l.kind = 'cut'
             or l.r2_key like 'r2://ponglens-media/lesson-video/%/original.%')
      and (o.id is null or o.status not in ('awaiting_submission', 'submitted', 'in_review', 'clarification', 'delivered'))), 0), 0)::bigint
  from auth.users u left join public.user_quotas q on q.user_id = u.id
  where coalesce(u.email, '') ilike '%' || trim(coalesce(p_search, '')) || '%'
     or coalesce(public._display_name(u.*), '') ilike '%' || trim(coalesce(p_search, '')) || '%'
  order by u.last_sign_in_at desc nulls last, u.id limit 30;
end;
$function$;
