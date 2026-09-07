-- Taking the coach off an entry left their name on it.
--
-- `coach_name` is kept in step with `coach_ref_id` by this trigger, but
-- only in one direction: it was written whenever a coach was attached and
-- never cleared when one was removed. So an entry unlinked from Zackary
-- went on reading "Lesson with Zackary" for ever, because the card renders
-- the name, not the link. Adil found two of his own doing exactly that.
--
-- The clear is deliberately narrow: only when an UPDATE takes a link that
-- was there away. `coach_name` also carries entries attributed by name
-- alone, from before player_coaches existed (085) — for those the name is
-- the only record there has ever been, and blanket-clearing on "no link"
-- would erase real history.
create or replace function public.lessons_coach_normalise()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_name text;
begin
  if new.coach_ref_id is null then
    new.shared_with_coach_at := null;
    -- The link was there and has just been taken away: the name it put
    -- there goes with it. A row that never had a link keeps its name.
    if tg_op = 'UPDATE' and old.coach_ref_id is not null then
      new.coach_name := null;
    end if;
    return new;
  end if;

  select pc.display_name into v_name
    from public.player_coaches pc
   where pc.id = new.coach_ref_id
     and pc.player_id = new.user_id;

  if v_name is null then
    raise exception 'coach_ref_id must be one of your own coaches';
  end if;

  new.coach_name := v_name;
  return new;
end;
$function$;
