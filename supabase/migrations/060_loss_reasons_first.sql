-- 060: "Why did you lose it?" becomes the question, and it takes custom pills.
--
-- The scorecard used to ask HOW a point ended (11 options) and only then,
-- gated on that answer, WHY it was lost. The valuable question sat three
-- levels deep behind one that told the player nothing — so "how" is retired
-- as a question and "why" moves to the front, keyed on who served rather
-- than on how the point ended.
--
-- Nothing is destroyed. points.confirmed_how keeps its column and every
-- stored value: the three error values (hit_into_net / missed_long /
-- missed_wide) are still WRITTEN, now as the follow-up to "Misread the
-- spin" — which spin you misread is exactly what where-it-went tells you.
-- The other endings stay READABLE on the matches that already have them.
--
-- points.direction (030) is retired the same way: still stored, still
-- rendered on old points, never asked again. Backhand/middle/forehand was
-- a third-level question few players reached, and the placement maps
-- answer it better.

-- ---------------------------------------------------------------------------
-- Custom loss reasons: the player's own vocabulary.
-- ---------------------------------------------------------------------------
-- Named loss_reason_labels, not loss_reasons, because points.loss_reasons
-- is an existing text[] column and one of those names has to give.
--
-- OWNER-keyed, exactly like public.tags (035) and for the same reason: a
-- coach adding "misread the pips" while reviewing your match must reuse
-- YOUR label, or the same problem counts as two across your matches. The
-- unique index on the lowercased label is what stops "Misread pips" and
-- "misread pips" becoming separate rows in your statistics.
create table if not exists public.loss_reason_labels (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  label      text not null check (char_length(btrim(label)) between 1 and 40),
  created_at timestamptz not null default now()
);

create unique index if not exists loss_reason_labels_owner_label_idx
  on public.loss_reason_labels (owner_id, lower(btrim(label)));

alter table public.loss_reason_labels enable row level security;

-- Same sharing model as tags: the owner and their accepted coaches share
-- one vocabulary; only the owner may rename or delete (a coach deleting a
-- label would silently strip it from every point that used it).
create policy "Owner and accepted coaches can view loss reason labels"
  on public.loss_reason_labels for select
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.coach_links cl
      where cl.player_id = loss_reason_labels.owner_id
        and cl.coach_id = auth.uid()
        and cl.status = 'accepted'
    )
  );

create policy "Owner and accepted coaches can create loss reason labels"
  on public.loss_reason_labels for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    or exists (
      select 1 from public.coach_links cl
      where cl.player_id = loss_reason_labels.owner_id
        and cl.coach_id = auth.uid()
        and cl.status = 'accepted'
    )
  );

create policy "Owner can update loss reason labels"
  on public.loss_reason_labels for update
  to authenticated
  using (owner_id = auth.uid());

create policy "Owner can delete loss reason labels"
  on public.loss_reason_labels for delete
  to authenticated
  using (owner_id = auth.uid());

grant select, insert, update, delete on public.loss_reason_labels
  to authenticated;

-- ---------------------------------------------------------------------------
-- points.loss_reasons: widen the vocabulary.
-- ---------------------------------------------------------------------------
-- Two new built-ins, both decided by WHO SERVED rather than by how the
-- point ended:
--   receive_error  offered only on points THEY served
--   (weak_serve, from 032, is its mirror on points YOU served)
--
-- receive_error could not exist before this migration: it was deliberately
-- left out of 032 because confirmed_how already had a 'receive_error'
-- ending and a chip would have double-counted it. Retiring the "how"
-- question is what frees the slot.
--
-- 'rushed' and 'too_aggressive' merge into one chip ("Went for too much").
-- Both values stay LEGAL so no stored row becomes invalid — 'rushed' is
-- simply never offered again and renders under the merged label, the same
-- shown-never-offered convention scorecard.ts already uses for legacy hows.
--
-- Custom pills are stored in the same array as 'custom:<uuid>', referencing
-- loss_reason_labels.id. A text[] with a prefix rather than a join table
-- keeps every existing consumer (matchAnalysis, stats/aggregate,
-- PointScorecard) reading point.loss_reasons unchanged. The trade is that
-- Postgres cannot enforce the reference: deleting a label leaves a
-- dangling id, which the app renders as an unknown pill rather than
-- crashing. Delete the label from the UI and it is removed from points
-- first; a direct SQL delete is the only way to orphan one.
create or replace function public.loss_reasons_valid(v text[])
returns boolean
language sql
immutable
as $$
  select v is null or not exists (
    select 1
    from unnest(v) as r
    where r <> all (array[
            'misread_spin', 'out_of_position', 'rushed', 'too_passive',
            'too_aggressive', 'weak_serve', 'lost_focus', 'their_winner',
            'receive_error'
          ]::text[])
      and r !~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
$$;

alter table public.points
  drop constraint if exists points_loss_reasons_vocab;
alter table public.points
  add constraint points_loss_reasons_vocab
  check (public.loss_reasons_valid(loss_reasons));

-- No new points column, so no new column-level UPDATE grant is needed:
-- confirmed_how was granted in 003 and loss_reasons in 032. Stated
-- explicitly because a missing grant here is silent — a newly-added column
-- reads fine and refuses to write, which is what broke points.direction
-- in 030.
