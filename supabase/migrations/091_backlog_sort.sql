-- 091: manual order, so the list carries priority instead of a due date.
--
-- The backlog stops asking when something is due. Capture is words and
-- nothing else, and scheduling becomes something you do later by dragging
-- a card into Today / Tomorrow / This week / Next week / Someday. Those
-- sections are derived from target_date, which already exists — no new
-- column, and no second source of truth about when a thing is meant to
-- happen.
--
-- What was missing is ORDER. Within a section the position is now the
-- priority: top is what you do first. That needs a key the client can
-- insert BETWEEN two existing values without rewriting the whole
-- section, so it is a float rather than an integer rank — dropping
-- between two cards is the midpoint of their two sorts, one UPDATE, no
-- renumbering.
--
-- Float precision is the known trade. Repeatedly halving the same gap
-- runs out of mantissa after roughly fifty splits in the same spot; the
-- client watches for a gap that small and rewrites that section's sorts
-- as whole numbers. That is a rare, local, one-section fix rather than a
-- constant cost on every move.

alter table public.backlog_items
  add column if not exists sort double precision not null default 0;

comment on column public.backlog_items.sort is
  'Manual position within a section, ascending: lower sorts sit higher up '
  'and are higher priority. Fractional so a card can be inserted between '
  'two others with a single update. Only meaningful relative to the other '
  'items sharing a target_date bucket.';

-- The list reads one section at a time, in order.
create index if not exists backlog_items_sort_idx
  on public.backlog_items (author_id, target_date nulls last, sort)
  where lane <> 'done';

-- Existing rows all share sort = 0, which would leave their order down to
-- whatever Postgres returned. Seed them by the order they were being
-- shown in until now — soonest date first, then newest first — so nothing
-- appears to shuffle itself the first time the new list renders.
with ordered as (
  select id,
         row_number() over (
           partition by author_id, target_date
           order by created_at desc
         )::double precision as position
  from public.backlog_items
)
update public.backlog_items b
set sort = ordered.position
from ordered
where ordered.id = b.id;
