-- A rally marked Skipped/let must leave an already-rendered automatic reel.
-- The first highlights migration intentionally leaves scoring and starring
-- alone, but is_let changes membership just as deletion does.

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
     or new.edited is distinct from old.edited
     or new.is_let is distinct from old.is_let then
    new.highlight_evidence := null;
  end if;
  return new;
end;
$$;

drop trigger if exists points_invalidate_highlight_evidence_trigger
  on public.points;
create trigger points_invalidate_highlight_evidence_trigger
  before update of t0, t1, cut_t0, clip_path, deleted, edited, is_let
  on public.points
  for each row execute function public.points_invalidate_highlight_evidence();
