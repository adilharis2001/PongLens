-- 047: journal photos + the vision-call budget.
--
--  * lessons.image_path — one attached photo per entry (r2://…, under
--    entry/<user_id>/…), moderated before storage. Scanned pages are the
--    other photo flow and are deliberately NOT stored: only their
--    transcribed text lands in the entry.
--  * ai_usage — per-user per-day counters for the paid vision calls
--    (page scans, image checks). bump_ai_usage increments atomically
--    UNDER the cap the API route passes, so two racing requests can
--    never both slip below the limit. Clients calling the RPC directly
--    can only spend their own allowance faster; the money gate stays in
--    the API routes, which use fixed caps.

alter table public.lessons
  add column if not exists image_path text;

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  ocr_pages int not null default 0,
  image_checks int not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
-- No client policies on purpose: only the definer RPC below touches it.

create or replace function public.bump_ai_usage(
  p_kind text,
  p_count int,
  p_cap int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  if auth.uid() is null or p_count < 1 or p_count > 20 then
    return false;
  end if;
  insert into ai_usage (user_id, day)
  values (auth.uid(), (now() at time zone 'utc')::date)
  on conflict (user_id, day) do nothing;
  if p_kind = 'ocr' then
    update ai_usage
      set ocr_pages = ocr_pages + p_count
      where user_id = auth.uid()
        and day = (now() at time zone 'utc')::date
        and ocr_pages + p_count <= p_cap
      returning true into ok;
  else
    update ai_usage
      set image_checks = image_checks + p_count
      where user_id = auth.uid()
        and day = (now() at time zone 'utc')::date
        and image_checks + p_count <= p_cap
      returning true into ok;
  end if;
  return coalesce(ok, false);
end
$$;

grant execute on function public.bump_ai_usage to authenticated;
