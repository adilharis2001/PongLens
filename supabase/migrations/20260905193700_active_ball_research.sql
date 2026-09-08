-- Independent research samples. No changes to released processing.
create table public.active_ball_samples (
  id uuid primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  venue text not null,
  split text not null check (split in ('train','validation','test')),
  frame integer not null check(frame >= 0),
  time_s double precision not null check(time_s >= 0),
  width integer not null check(width > 0),
  height integer not null check(height > 0),
  frame_keys jsonb not null,
  corners jsonb not null,
  label jsonb,
  prediction jsonb,
  model_run text,
  revision integer not null default 0,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(match_id, frame)
);
alter table public.active_ball_samples enable row level security;
revoke all on public.active_ball_samples from anon, authenticated;
grant select on public.active_ball_samples to authenticated;
grant update(label, revision, reviewed_by, reviewed_at) on public.active_ball_samples to authenticated;
create policy active_ball_admin_read on public.active_ball_samples for select to authenticated using(public.is_admin());
create policy active_ball_admin_update on public.active_ball_samples for update to authenticated using(public.is_admin()) with check(public.is_admin());

create table public.active_ball_label_history (
  sample_id uuid not null references public.active_ball_samples(id) on delete cascade,
  revision integer not null,
  label jsonb,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  primary key(sample_id, revision)
);
alter table public.active_ball_label_history enable row level security;
revoke all on public.active_ball_label_history from anon, authenticated;
grant select on public.active_ball_label_history to authenticated;
create policy active_ball_history_admin_read on public.active_ball_label_history for select to authenticated using(public.is_admin());
create function public.record_active_ball_label() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.label is distinct from old.label or new.revision <> old.revision then
    insert into public.active_ball_label_history(sample_id,revision,label,reviewed_by,reviewed_at)
    values(new.id,new.revision,new.label,new.reviewed_by,new.reviewed_at);
  end if;
  return new;
end;
$$;
revoke all on function public.record_active_ball_label() from public;
create trigger active_ball_label_history after update on public.active_ball_samples for each row execute function public.record_active_ball_label();
