-- Frozen research corpus. No FK to points: reprocessing must not erase labels.
create table public.point_ending_research (
  id uuid primary key,
  batch text not null default 'out-ball-479-v1',
  match_id uuid not null,
  processing_version_id uuid not null,
  sequence integer not null,
  source jsonb not null,
  media_path text not null check (media_path ~ '^r2://ponglens-raw/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mov|mp4)$'),
  original_annotations jsonb not null default '[]',
  label jsonb not null default '{"reason":null,"custom":"","note":""}',
  revision integer not null default 0 check (revision>=0),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  unique(batch,sequence),
  constraint valid_ending_label check (
    jsonb_typeof(label)='object' and label ?& array['reason','custom','note']
    and (label->'reason'='null'::jsonb or label->>'reason' in ('long','wide','net','missed_return','double_bounce','serve_fault','edge','continuing','unsure','custom'))
    and jsonb_typeof(label->'custom')='string' and length(label->>'custom')<=120
    and jsonb_typeof(label->'note')='string' and length(label->>'note')<=4000
    and (label->>'reason' is distinct from 'custom' or length(btrim(label->>'custom'))>0)
  )
);
create table public.point_ending_label_history (
  point_id uuid not null references public.point_ending_research(id),
  revision integer not null,
  label jsonb not null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  primary key(point_id,revision)
);
create table public.point_ending_imports (
  sha256 text primary key check(length(sha256)=64),
  name text not null,
  payload jsonb not null,
  imported_at timestamptz not null default now()
);
create table public.point_ending_custom_reasons (
  name text primary key check(length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);
alter table public.point_ending_research enable row level security;
alter table public.point_ending_label_history enable row level security;
alter table public.point_ending_imports enable row level security;
alter table public.point_ending_custom_reasons enable row level security;
create policy admin_read on public.point_ending_research for select to authenticated using(public.is_admin());
create policy admin_update on public.point_ending_research for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy admin_read on public.point_ending_label_history for select to authenticated using(public.is_admin());
create policy admin_read on public.point_ending_imports for select to authenticated using(public.is_admin());
create policy admin_read on public.point_ending_custom_reasons for select to authenticated using(public.is_admin());
revoke all on public.point_ending_research,public.point_ending_label_history,public.point_ending_imports,public.point_ending_custom_reasons from anon,authenticated;
grant select on public.point_ending_research,public.point_ending_label_history,public.point_ending_imports,public.point_ending_custom_reasons to authenticated;
grant update(label,revision) on public.point_ending_research to authenticated;
grant all on public.point_ending_research,public.point_ending_label_history,public.point_ending_imports,public.point_ending_custom_reasons to service_role;

-- The trigger records the actual authenticated reviewer, retains every revision,
-- and stores reusable custom options in the same transaction as the label.
create function public.record_point_ending_label() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if TG_OP='UPDATE' then
    if NEW.revision <> OLD.revision+1 then raise exception 'Label revision must advance by one'; end if;
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  end if;
  insert into public.point_ending_label_history(point_id,revision,label,reviewed_by,reviewed_at)
  values(NEW.id,NEW.revision,NEW.label,NEW.reviewed_by,coalesce(NEW.reviewed_at,now()));
  if NEW.label->>'reason'='custom' then
    insert into public.point_ending_custom_reasons(name) values(btrim(NEW.label->>'custom')) on conflict do nothing;
  end if;
  return NEW;
end $$;
-- AFTER insert for FK visibility; BEFORE update for reviewer attribution.
create trigger point_ending_insert_history after insert on public.point_ending_research for each row execute function public.record_point_ending_label();
create trigger point_ending_update_history before update on public.point_ending_research for each row execute function public.record_point_ending_label();
revoke all on function public.record_point_ending_label() from public;
