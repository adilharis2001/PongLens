import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const CONTAINER = "ponglens-canonical-score-test";
const IMAGE = "postgres:17-alpine";
const DATABASE = "ponglens_test";
const PASSWORD = "ponglens_local_only";

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

create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
grant usage on schema auth to authenticated;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

create table public.matches (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_server text check (first_server in ('user', 'opponent')),
  first_server_source text check (first_server_source in ('user', 'detected')),
  active_processing_version_id uuid,
  cut_source text not null default 'auto' check (cut_source in ('auto', 'manual')),
  created_at timestamptz not null default now()
);
create table public.points (
  id uuid primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  processing_version_id uuid not null,
  idx integer not null,
  t0 numeric,
  t1 numeric,
  cut_t0 numeric,
  tight_start boolean not null default false,
  tight_end boolean not null default false,
  deleted boolean not null default false,
  confirmed_winner text check (confirmed_winner in ('user', 'opponent')),
  confirmed_how text,
  is_let boolean not null default false,
  server_override text check (server_override in ('user', 'opponent')),
  game_end_override text check (game_end_override in ('end', 'continue')),
  game_winner_override text check (game_winner_override in ('user', 'opponent')),
  check (not (is_let and confirmed_winner is not null))
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

alter table public.matches enable row level security;
alter table public.points enable row level security;
create policy matches_owner_read on public.matches for select to authenticated
  using (user_id = auth.uid());
create policy points_match_access on public.points for select to authenticated
  using (public.has_match_access(match_id));
grant select on public.matches, public.points to authenticated;
`;

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260915190000_canonical_scored_match_state.sql",
    import.meta.url
  ),
  "utf8"
);

docker(
  ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE],
  { input: `${bootstrap}\n${migration}` }
);

process.stdout.write(
  `Isolated scoring database is ready in ${CONTAINER}.\n` +
    `Run: SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state\n`
);
