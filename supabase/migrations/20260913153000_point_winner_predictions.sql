-- Camera-relative observations are private and never enter the owner's score.
-- The point FK is the sole identity: its processing version is immutable, and
-- versions may legitimately contain the same idx. No historical backfill.
create table public.point_winner_predictions (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references public.points(id) on delete cascade,
  schema_version integer not null check(schema_version = 1),
  method text not null check(length(method) between 1 and 80),
  method_version text not null check(length(method_version) between 1 and 120),
  input_fingerprint text not null check(input_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check(status in ('predicted','abstained','error')),
  winner_side text check(winner_side in ('near','far')),
  reason text not null check(length(reason) between 1 and 160),
  evaluated_t0 numeric not null check(evaluated_t0 >= 0 and evaluated_t0 < 'Infinity'::numeric),
  evaluated_t1 numeric not null check(evaluated_t1 > evaluated_t0 and evaluated_t1 < 'Infinity'::numeric),
  published_t0 numeric not null check(published_t0 >= 0 and published_t0 < 'Infinity'::numeric),
  published_t1 numeric not null check(published_t1 > published_t0 and published_t1 < 'Infinity'::numeric),
  source_clock text not null default 'processing_source_seconds' check(source_clock = 'processing_source_seconds'),
  source_identity text not null check(length(source_identity) between 1 and 2048),
  source_offset_s numeric not null check(source_offset_s >= 0 and source_offset_s < 'Infinity'::numeric),
  source_job_id uuid not null,
  release_id text not null check(length(release_id) between 1 and 256),
  evidence jsonb not null check(jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 65536),
  created_at timestamptz not null default now(),
  check((status = 'predicted' and winner_side is not null)
     or (status in ('abstained','error') and winner_side is null)),
  unique(point_id,method,method_version,input_fingerprint)
);
comment on table public.point_winner_predictions is
  'Private immutable worker observations. Physical near/far, never confirmed_winner. A terminal-event hypothesis is not a whole-card winner when multiple rallies are unresolved.';
comment on column public.point_winner_predictions.source_offset_s is
  'Add this actual applied trim offset to processing-source seconds to obtain original source seconds.';
comment on column public.point_winner_predictions.source_job_id is
  'Execution provenance retained even if the job is later deleted; lifetime follows the point, not the job.';
alter table public.point_winner_predictions enable row level security;
revoke all on public.point_winner_predictions from public,anon,authenticated,service_role;
grant select,insert,delete on public.point_winner_predictions to service_role;

-- Reading status never changes the frozen observation. Score corrections and
-- user-side changes leave it applicable; timing changes make it stale. Soft
-- deletions and superseded versions remain separately identifiable.
create view public.private_point_winner_prediction_status as
select r.*,p.match_id,p.processing_version_id,
       (p.t0 = r.published_t0 and p.t1 = r.published_t1) as window_is_current,
       p.deleted as point_is_deleted,
       (p.processing_version_id = m.active_processing_version_id) as version_is_active
from public.point_winner_predictions r
join public.points p on p.id=r.point_id
join public.matches m on m.id=p.match_id;
revoke all on public.private_point_winner_prediction_status from public,anon,authenticated,service_role;
grant select on public.private_point_winner_prediction_status to service_role;
