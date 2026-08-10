-- 090: what has to come first — dependencies between backlog items.
--
-- A backlog without this quietly lies: "Now" lists things you cannot
-- actually start, and you rediscover why every time you read the row.
-- One edge = "this item waits on that one".
--
-- Many-to-many rather than a single parent, because both directions are
-- real: one prerequisite commonly unblocks several things (Stripe keys
-- unblock the launch AND the announcement), and one item commonly needs
-- two things before it can start.
--
-- An edge is advisory, never an enforcement. Nothing here stops an item
-- being ticked out of order — a backlog is a memory aid, not a workflow
-- engine, and the day the real world goes out of order is the day you
-- most need to just tick the thing.

create table public.backlog_blockers (
  -- The item that has to wait.
  item_id    uuid not null references public.backlog_items (id)
             on delete cascade,
  -- The item it waits on.
  blocker_id uuid not null references public.backlog_items (id)
             on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, blocker_id),
  constraint backlog_blockers_not_self check (item_id <> blocker_id)
);

comment on table public.backlog_blockers is
  'Advisory "must come first" edges between backlog_items. Deleting either '
  'item drops the edge; nothing here blocks a write to backlog_items.';

-- The reverse lookup: "what does ticking this one release?"
create index backlog_blockers_blocker_idx
  on public.backlog_blockers (blocker_id);

-- ---------------------------------------------------------------------------
-- Cycles. Two items waiting on each other can never both be startable, and
-- the UI's "is this blocked" walk would recurse forever. The self-edge is a
-- table constraint; anything longer needs the graph, so it is a trigger.
--
-- The row is not inserted yet (BEFORE trigger), so the walk sees the graph
-- as it stands: if blocker_id already waits — at any depth — on item_id,
-- then adding this edge closes a loop.
-- ---------------------------------------------------------------------------
create or replace function public.backlog_blockers_no_cycle()
returns trigger
language plpgsql
as $$
begin
  if exists (
    with recursive upstream(id) as (
      select new.blocker_id
      union
      select b.blocker_id
      from public.backlog_blockers b
      join upstream u on b.item_id = u.id
    )
    select 1 from upstream where id = new.item_id
  ) then
    raise exception
      'That would make two items wait on each other'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger backlog_blockers_no_cycle
  before insert or update on public.backlog_blockers
  for each row execute function public.backlog_blockers_no_cycle();

-- ---------------------------------------------------------------------------
-- RLS: same owner as the items themselves. `with check` verifies BOTH ends
-- belong to the caller — without the blocker_id half, a row could point at
-- an item the caller does not own and leak its existence through the
-- "waiting on" chip.
-- ---------------------------------------------------------------------------
alter table public.backlog_blockers enable row level security;

create policy "Admin manages own backlog blockers"
  on public.backlog_blockers for all
  to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.backlog_items i
      where i.id = backlog_blockers.item_id
        and i.author_id = (select auth.uid())
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1 from public.backlog_items i
      where i.id = backlog_blockers.item_id
        and i.author_id = (select auth.uid())
    )
    and exists (
      select 1 from public.backlog_items b
      where b.id = backlog_blockers.blocker_id
        and b.author_id = (select auth.uid())
    )
  );

revoke all on public.backlog_blockers from anon;
grant select, insert, delete on public.backlog_blockers to authenticated;
