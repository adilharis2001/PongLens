-- 056: Journal hardening.
--
-- Account for attached Journal images in the storage ledger, expose
-- owner-scoped append/negation paths to authenticated API callers, and
-- support recent-first note feed retrieval.

alter table public.storage_ledger
  drop constraint if exists storage_ledger_kind_check;
alter table public.storage_ledger
  add constraint storage_ledger_kind_check
  check (kind in ('clip', 'cut', 'voice', 'reel', 'entry_image', 'other'));

create or replace function public.ledger_append_entry_image(
  p_bytes bigint,
  p_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 104857600 then
    raise exception 'invalid byte count';
  end if;
  if p_key not like 'r2://ponglens-media/entry/' || auth.uid() || '/%' then
    raise exception 'invalid key';
  end if;
  insert into public.storage_ledger (user_id, kind, bytes, r2_key)
  values (auth.uid(), 'entry_image', p_bytes, p_key);
end;
$$;

create or replace function public.ledger_negate_entry_image(
  p_key text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  negated int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_key not like 'r2://ponglens-media/entry/' || auth.uid() || '/%' then
    raise exception 'invalid key';
  end if;
  if exists (
    select 1
    from public.lessons
    where image_path = p_key
      and user_id = auth.uid()
  ) then
    raise exception 'image is still attached';
  end if;
  select public._ledger_negate_keys(array[p_key]) into negated;
  return coalesce(negated, 0);
end;
$$;

revoke execute on function public.ledger_append_entry_image(bigint, text)
  from public, anon;
grant execute on function public.ledger_append_entry_image(bigint, text)
  to authenticated;

revoke execute on function public.ledger_negate_entry_image(text)
  from public, anon;
grant execute on function public.ledger_negate_entry_image(text)
  to authenticated;

create index if not exists notes_created_at_idx
  on public.notes (created_at desc);
