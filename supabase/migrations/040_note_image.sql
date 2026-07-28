-- 040: frame-annotation notes — a note can carry a drawn-on video frame.
--
--  * notes.image_path — r2://ponglens-media/sketch/<author_id>/<uuid>.jpg,
--    written by /api/note-image. Client-writable text, so /api/media-url
--    only signs keys under the note AUTHOR's own sketch folder — the same
--    trust model as audio_path.
--  * ledger_append_sketch — storage accounting for the frame images
--    (kind 'other'). Sketches are kept while the account is active: they
--    are part of the note's long-term value, so no retention sweep tier.

alter table public.notes add column image_path text;

create or replace function public.ledger_append_sketch(p_bytes bigint, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 20971520 then
    raise exception 'invalid byte count';
  end if;
  if p_key not like 'r2://ponglens-media/sketch/' || auth.uid() || '/%' then
    raise exception 'invalid key';
  end if;
  insert into public.storage_ledger (user_id, kind, bytes, r2_key)
  values (auth.uid(), 'other', p_bytes, p_key);
end;
$$;

revoke execute on function public.ledger_append_sketch(bigint, text) from public, anon;
grant execute on function public.ledger_append_sketch(bigint, text) to authenticated;
