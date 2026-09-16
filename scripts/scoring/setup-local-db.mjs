import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const CONTAINER = "ponglens-canonical-score-test";
const IMAGE = "postgres:17-alpine";
const DATABASE = "ponglens_test";
const PASSWORD = "ponglens_local_only";
const PRODUCTION_LIKE = process.env.SCORING_PRODUCTION_LIKE === "1";

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: options.input ? ["pipe", "inherit", "inherit"] : "pipe",
    input: options.input,
  });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`docker ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

docker(["rm", "-f", CONTAINER], { allowFailure: true });
docker([
  "run",
  "--name",
  CONTAINER,
  "-e",
  `POSTGRES_PASSWORD=${PASSWORD}`,
  "-e",
  `POSTGRES_DB=${DATABASE}`,
  "-d",
  IMAGE,
]);

let ready = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  const status = docker(
    [
      "exec", CONTAINER, "psql", "-At", "-U", "postgres", "-d", DATABASE,
      "-c", "select 1",
    ],
    { allowFailure: true }
  );
  if (status.status === 0) {
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error("isolated PostgreSQL did not become ready");

const bootstrap = String.raw`
create extension if not exists pgcrypto;
do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
do $$ begin
  create role ponglens_worker nologin;
exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
grant usage on schema auth to authenticated;

create table public.app_config (
  key text primary key,
  value text not null
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

create table public.matches (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid,
  status text not null default 'uploaded',
  first_server text check (first_server in ('user', 'opponent')),
  first_server_source text check (first_server_source in ('user', 'detected')),
  active_processing_version_id uuid,
  cut_source text not null default 'auto' check (cut_source in ('auto', 'manual')),
  created_at timestamptz not null default now()
);
create table public.points (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  processing_version_id uuid not null,
  idx integer not null,
  t0 numeric,
  t1 numeric,
  cut_t0 numeric,
  clip_path text,
  tight_start boolean not null default false,
  tight_end boolean not null default false,
  deleted boolean not null default false,
  confirmed_winner text check (confirmed_winner in ('user', 'opponent')),
  confirmed_how text,
  is_let boolean not null default false,
  server text check (server in ('user', 'opponent')),
  server_override text check (server_override in ('user', 'opponent')),
  game_end_override text check (game_end_override in ('end', 'continue')),
  game_winner_override text check (game_winner_override in ('user', 'opponent')),
  scored_at_cut_s numeric check (scored_at_cut_s is null or scored_at_cut_s >= 0),
  rally_end_cut_s numeric check (rally_end_cut_s is null or rally_end_cut_s >= 0),
  serve_spin text,
  serve_sidespin boolean,
  serve_length text,
  direction text,
  loss_reasons text[],
  misread_kind text,
  edited boolean not null default false,
  starred boolean not null default false,
  check (not (is_let and confirmed_winner is not null))
);
create table public.jobs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  status text not null,
  options jsonb not null default '{}'::jsonb
);
create table public.coach_links (
  player_id uuid not null,
  coach_id uuid,
  status text not null,
  scope_match_id uuid,
  all_matches boolean not null default false
);
create table public.hand_cut_drafts (
  match_id uuid primary key references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  marks jsonb not null default '[]'::jsonb,
  submitted_at timestamptz
);
create table public.fullmatch_labels (
  id uuid primary key default gen_random_uuid(),
  match_key text not null,
  kind text not null,
  t_s numeric not null
);
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  token text not null unique,
  kind text not null,
  show_score boolean not null default true,
  revoked_at timestamptz
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users
     where id = auth.uid() and email = 'admin@example.test'
  )
$$;
create or replace function public.has_match_access(m_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matches m
     where m.id = m_id and (
       m.user_id = auth.uid() or exists (
         select 1 from public.coach_links c
          where c.player_id = m.user_id
            and c.coach_id = auth.uid()
            and c.status = 'accepted'
            and (c.scope_match_id = m.id or c.all_matches)
       )
     )
  )
$$;

-- Production already has these established structural RPCs. The isolated
-- schema supplies their minimum behavior so the v2 transaction wrappers are
-- exercised against the same call boundary without loading unrelated media,
-- commerce and notification migrations.
create or replace function public.split_point(
  p_id uuid, at_t numeric, child_cut_t0 numeric default null
) returns public.points language plpgsql security definer set search_path=public as $$
declare orig public.points; child public.points;
begin
  select * into orig from public.points where id=p_id for update;
  if orig.id is null or orig.deleted or at_t < orig.t0 + 0.2 or at_t > orig.t1 - 0.2 then
    raise exception 'invalid split';
  end if;
  update public.points set t1=at_t,edited=true,tight_end=true where id=orig.id;
  insert into public.points(
    match_id,processing_version_id,idx,t0,t1,cut_t0,server,edited,tight_start,tight_end
  ) values (
    orig.match_id,orig.processing_version_id,
    (select coalesce(max(idx),0)+1 from public.points where match_id=orig.match_id),
    at_t,orig.t1,child_cut_t0,orig.server,true,true,orig.tight_end
  ) returning * into child;
  return child;
end $$;

create or replace function public.adjust_point(
  p_id uuid, p_t0 numeric, p_t1 numeric,
  p_tight_start boolean default null, p_tight_end boolean default null,
  p_scored_at_cut_s numeric default null, p_rally_end_cut_s numeric default null
) returns public.points language plpgsql security definer set search_path=public as $$
declare orig public.points; changed public.points;
begin
  select * into orig from public.points where id=p_id for update;
  if orig.id is null or orig.deleted or p_t0 < 0 or p_t1-p_t0 < 0.5 then
    raise exception 'invalid adjustment';
  end if;
  update public.points set
    t0=p_t0,t1=p_t1,
    tight_start=coalesce(p_tight_start,tight_start),
    tight_end=coalesce(p_tight_end,tight_end),edited=true,
    cut_t0=case when cut_t0 is null then null else greatest(0,cut_t0+(p_t0-orig.t0)) end,
    scored_at_cut_s=case when p_t1<>orig.t1 then p_scored_at_cut_s else scored_at_cut_s end,
    rally_end_cut_s=case when p_t1<>orig.t1 then p_rally_end_cut_s else rally_end_cut_s end
  where id=p_id returning * into changed;
  return changed;
end $$;

create or replace function public.insert_point(
  p_prev_id uuid, p_next_id uuid, p_t0 numeric, p_t1 numeric,
  p_cut_t0 numeric default null
) returns public.points language plpgsql security definer set search_path=public as $$
declare prev public.points; nxt public.points; v_match uuid; v_version uuid; created public.points;
begin
  if p_prev_id is null and p_next_id is null then raise exception 'neighbour required'; end if;
  if p_prev_id is not null then
    select * into prev from public.points where id=p_prev_id for update;
    v_match:=prev.match_id; v_version:=prev.processing_version_id;
  end if;
  if p_next_id is not null then
    select * into nxt from public.points where id=p_next_id for update;
    if v_match is not null and nxt.match_id<>v_match then raise exception 'different matches'; end if;
    v_match:=nxt.match_id; v_version:=nxt.processing_version_id;
  end if;
  if p_t0 is null or p_t1-p_t0<0.5 then raise exception 'invalid insert'; end if;
  insert into public.points(match_id,processing_version_id,idx,t0,t1,cut_t0,edited,tight_start,tight_end)
  values(v_match,v_version,(select coalesce(max(idx),0)+1 from public.points where match_id=v_match),
         p_t0,p_t1,greatest(coalesce(p_cut_t0,0),0),true,prev.id is not null,nxt.id is not null)
  returning * into created;
  if prev.id is not null and prev.t1>p_t0 then
    update public.points set t1=p_t0,edited=true,tight_end=true where id=prev.id;
  end if;
  if nxt.id is not null and nxt.t0<p_t1 then
    update public.points set t0=p_t1,edited=true,tight_start=true,
      cut_t0=case when cut_t0 is null then null else greatest(0,cut_t0+(p_t1-nxt.t0)) end
    where id=nxt.id;
  end if;
  update public.points set server_override=null
   where match_id=v_match and processing_version_id=v_version and not deleted
     and server_override is not null and (coalesce(t0,9999999),idx)>(p_t0,created.idx);
  return created;
end $$;

create or replace function public.request_reclip(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$ begin return; end $$;

alter table public.matches enable row level security;
alter table public.points enable row level security;
create policy matches_owner_read on public.matches for select to authenticated
  using (user_id = auth.uid());
create policy points_match_access on public.points for select to authenticated
  using (public.has_match_access(match_id));
grant select on public.matches, public.points to authenticated;
grant update (first_server, first_server_source) on public.matches to authenticated;
grant update (
  confirmed_winner, confirmed_how, is_let, server_override,
  game_end_override, game_winner_override, deleted
) on public.points to authenticated;
`;

const migrations = [
  "20260915190000_canonical_scored_match_state.sql",
  "20260916120000_canonical_score_commands.sql",
  "20260916133000_canonical_score_capability_rollback.sql",
  "20260916143000_canonical_score_readers.sql",
  "20260916150000_stats_game_winner_fingerprint.sql",
  "20260916153000_canonical_share_score_shadow.sql",
].map((name) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8")
);

docker(
  ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE],
  { input: bootstrap }
);

if (PRODUCTION_LIKE) {
  const legacyFixture = String.raw`
insert into auth.users(id,email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.test'),
  ('22222222-2222-4222-8222-222222222222','admin@example.test'),
  ('33333333-3333-4333-8333-333333333333','coach@example.test'),
  ('44444444-4444-4444-8444-444444444444','stranger@example.test');

insert into public.coach_links(player_id,coach_id,status,all_matches)
values ('11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333','accepted',true);

insert into public.matches(
  id,user_id,status,first_server,first_server_source,
  active_processing_version_id,cut_source,created_at
)
select md5('match-'||n)::uuid,
       '11111111-1111-4111-8111-111111111111'::uuid,
       'ready',
       case when n % 5 = 0 then null when n % 2 = 0 then 'user' else 'opponent' end,
       case when n % 5 = 0 then null when n % 3 = 0 then 'detected' else 'user' end,
       md5('version-'||n)::uuid,
       case when n <= 5 then 'manual' else 'auto' end,
       now() - make_interval(days => 220-n)
  from generate_series(1,220) n;

insert into public.points(
  match_id,processing_version_id,idx,t0,t1,cut_t0,
  confirmed_winner,confirmed_how,is_let,server,server_override,
  game_end_override,game_winner_override,deleted,edited
)
select md5('match-'||m)::uuid,
       md5('version-'||m)::uuid,
       p,
       case when m % 17 = 0 and p = 1 then null else (p*8)::numeric end,
       case when m % 17 = 0 and p = 1 then null else (p*8+5)::numeric end,
       (p*6)::numeric,
       case when p % 19 = 0 or p % 37 = 0 then null
            when p % 2 = 0 then 'user' else 'opponent' end,
       case when p % 19 = 0 then 'skip:other'
            when p % 37 = 0 then null else 'point' end,
       p % 37 = 0,
       case when p % 2 = 0 then 'user' else 'opponent' end,
       case when p = 12 and m % 7 = 0 then 'user' end,
       case when p in (11,22,33,44,55,66,77,88) and m % 4 = 0 then 'end' end,
       case when p = 88 and m % 8 = 0 then 'opponent' end,
       p = 45 and m % 11 = 0,
       p % 23 = 0
  from generate_series(1,220) m
  cross join generate_series(1,90) p;

insert into public.hand_cut_drafts(match_id,user_id,marks,submitted_at)
select md5('match-'||m)::uuid,
       '11111111-1111-4111-8111-111111111111'::uuid,
       (select jsonb_agg(jsonb_build_object(
          't0',p*8,'t1',p*8+5,'tap',p*8+0.25,'rate',1
        ) order by p) from generate_series(1,90) p),
       now()
  from generate_series(1,5) m;

insert into public.share_links(match_id,token,kind,show_score)
values (md5('match-220')::uuid,repeat('p',48),'match',true);
`;
  docker(
    ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE],
    { input: legacyFixture }
  );
}

const migrationStartedAt = performance.now();
docker(
  ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE],
  { input: migrations.join("\n") }
);
const migrationElapsedMs = performance.now() - migrationStartedAt;

process.stdout.write(
  `Isolated scoring database is ready in ${CONTAINER}.\n` +
    (PRODUCTION_LIKE
      ? `Production-like fixture: 220 matches, 19,800 points, 5 manual cuts; migrations ${migrationElapsedMs.toFixed(1)} ms.\n`
      : "") +
    `Run: SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state\n`
);
