-- Theme analysis: the noted cards, playable, across every match.
--
-- 150 gave the review page `admin_review_notes`, which answers "what did I
-- write and under which theme". That is enough to LIST a card and no use at
-- all for playing one: it returns t0/t1 in source seconds and stops there.
-- A player needs the cut clock (`cut_t0` plus the pad actually applied), the
-- match's pads, and the path to the artifacts the overlays are drawn from.
--
-- So this is the same question asked by a page that intends to show the
-- footage rather than link to it. It stays a separate function rather than a
-- widening of `admin_review_notes`, because the themes page in /admin renders
-- the narrow shape today and there is no reason to make it carry a payload it
-- does not draw.
--
-- The pad is NOT computed here. `clipPad` in the app already resolves stored
-- pads against the job's strictness and the frozen pre-048 table, and
-- `effectivePad` then narrows it on a split boundary. Reimplementing either
-- in SQL would be a second statement of a rule that has been wrong before.
-- The row carries the raw material — clip_pads, strictness, tight_start,
-- tight_end — and the app applies its own rule to it.

create or replace function public.admin_theme_cards(
  p_theme_id uuid default null
)
returns table (
  point_id uuid,
  match_id uuid,
  idx integer,
  t0 numeric,
  t1 numeric,
  cut_t0 numeric,
  tight_start boolean,
  tight_end boolean,
  has_clip boolean,
  note text,
  note_at timestamptz,
  theme_ids uuid[],
  themes text[],
  opponent_name text,
  venue text,
  played_at timestamptz,
  clip_pads jsonb,
  strictness text,
  match_json_path text,
  has_cut boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select
    p.id,
    m.id,
    p.idx,
    p.t0,
    p.t1,
    p.cut_t0,
    coalesce(p.tight_start, false),
    coalesce(p.tight_end, false),
    (p.clip_path is not null),
    n.body,
    n.updated_at,
    coalesce(
      array_agg(t.id order by t.label) filter (where t.id is not null),
      '{}'
    ),
    coalesce(
      array_agg(t.label order by t.label) filter (where t.label is not null),
      '{}'
    ),
    m.opponent_name,
    m.venue,
    m.played_at,
    m.clip_pads,
    -- The strictness the cut was made with. Found the way 144 finds it:
    -- the match's own job_id first, and only then the job that names this
    -- match in its options, newest first. There is no jobs.match_id column,
    -- and a job reached the other way round can belong to another match.
    --
    -- Only consulted when the match has no stored `clip_pads`: `clipPad`
    -- prefers those and falls back to the frozen pre-048 table by
    -- strictness, so on a modern match this value is never read.
    coalesce(
      (
        select j.options ->> 'strictness'
        from public.jobs j
        where j.id = m.job_id
      ),
      (
        select j.options ->> 'strictness'
        from public.jobs j
        where j.options ->> 'match_id' = m.id::text
        order by j.created_at desc
        limit 1
      )
    ),
    m.match_json_path,
    (m.cut_path is not null)
  from public.points p
  join public.matches m on m.id = p.match_id
  left join public.admin_point_notes n on n.point_id = p.id
  left join public.admin_point_themes pt on pt.point_id = p.id
  left join public.admin_themes t on t.id = pt.theme_id
  where (
      p_theme_id is null
      or exists (
        select 1
        from public.admin_point_themes x
        where x.point_id = p.id and x.theme_id = p_theme_id
      )
    )
    -- A card earns its place by carrying a theme. A note with no theme is
    -- readable on the /admin review page and is not what this page groups.
    and pt.point_id is not null
  group by p.id, m.id, p.idx, p.t0, p.t1, p.cut_t0, p.tight_start,
           p.tight_end, p.clip_path, n.body, n.updated_at, m.opponent_name,
           m.venue, m.played_at, m.clip_pads, m.match_json_path, m.cut_path
  order by m.played_at desc nulls last, p.t0;
end;
$function$;

comment on function public.admin_theme_cards(uuid) is
  'Themed cards across every match, carrying enough of the cut clock and the '
  'match''s pads for the research theme page to play each one.';

revoke all on function public.admin_theme_cards(uuid) from public, anon;
grant execute on function public.admin_theme_cards(uuid) to authenticated;
