-- 101: coach outreach, the first space in the marketing hub.
--
-- Three tables. A coach is one row keyed by their Instagram handle, which
-- is the only identifier every coach reliably has: the discovery run found
-- 43 of them and not one exposed an email through Instagram itself. Their
-- ways of being reached live in a separate table because a coach has
-- several, they arrive from different places, and where each one came from
-- matters -- an address published on a club's contact page is a different
-- thing from one scraped off a profile, and only the first is comfortable
-- footing for a cold email in Europe.
--
-- Touches record what was said and through which channel. Instagram DMs
-- are sent by hand from Adil's own account and marked here; email is
-- queued here and drained by the Fastmail worker. Same table either way,
-- so the history of a coach reads in one list.
--
-- Access is the marketing role or the admin, the same gate as the hub.

-- ---------------------------------------------------------------------------
-- The pipeline
-- ---------------------------------------------------------------------------
create table public.outreach_coaches (
  id            uuid primary key default gen_random_uuid(),
  handle        text not null unique,
  full_name     text,
  bio           text,
  followers     integer not null default 0,
  -- Inferred, never authoritative: script + stopwords for language, TLD and
  -- bio hints for country. Both are for sorting the list, not for deciding
  -- anything irreversible, so a wrong guess costs an eyebrow and not a row.
  language      text,
  country       text,
  english       boolean not null default false,
  profile_url   text,
  avatar_url    text,
  -- Why we believe this is a coach, in one line, so a judgement call made
  -- by a script three weeks ago can still be argued with.
  fit_note      text,
  -- The search term or directory that surfaced them. Tells us which source
  -- actually converts once replies start landing.
  discovered_via text,
  stage         text not null default 'found'
                check (stage in ('found', 'qualified', 'ready', 'contacted',
                                 'replied', 'not_a_fit', 'no_reply',
                                 'signed_up', 'do_not_contact')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index outreach_coaches_stage_idx
  on public.outreach_coaches (stage, english desc, followers desc);

create trigger outreach_coaches_set_updated_at
  before update on public.outreach_coaches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- How to reach them
-- ---------------------------------------------------------------------------
create table public.outreach_channels (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references public.outreach_coaches (id)
             on delete cascade,
  kind       text not null
             check (kind in ('instagram', 'email', 'whatsapp', 'telegram',
                             'website', 'youtube', 'phone', 'form')),
  value      text not null,
  -- 'profile' came off Instagram, 'bio_link' off the site they linked,
  -- 'directory' off a federation or club listing, 'manual' from Adil.
  source     text not null default 'profile'
             check (source in ('profile', 'bio_link', 'directory', 'manual')),
  created_at timestamptz not null default now(),
  unique (coach_id, kind, value)
);

create index outreach_channels_coach_idx
  on public.outreach_channels (coach_id);

-- ---------------------------------------------------------------------------
-- What was said
-- ---------------------------------------------------------------------------
create table public.outreach_touches (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references public.outreach_coaches (id)
             on delete cascade,
  kind       text not null
             check (kind in ('instagram', 'email', 'whatsapp')),
  direction  text not null default 'out' check (direction in ('out', 'in')),
  subject    text,
  body       text not null default '',
  -- A DM goes 'draft' -> 'sent' when Adil marks it; an email goes
  -- 'draft' -> 'queued' when he presses send and 'sent' when the Fastmail
  -- worker drains the queue. Nothing in the web app sends anything.
  status     text not null default 'draft'
             check (status in ('draft', 'queued', 'sent', 'failed')),
  error      text,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outreach_touches_coach_idx
  on public.outreach_touches (coach_id, created_at desc);

create index outreach_touches_queue_idx
  on public.outreach_touches (status, created_at)
  where status = 'queued';

create trigger outreach_touches_set_updated_at
  before update on public.outreach_touches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- What the agents did
-- ---------------------------------------------------------------------------
create table public.outreach_runs (
  id          uuid primary key default gen_random_uuid(),
  agent       text not null
              check (agent in ('discover', 'enrich', 'draft', 'send', 'replies')),
  status      text not null default 'running'
              check (status in ('running', 'succeeded', 'failed')),
  found       integer not null default 0,
  added       integer not null default 0,
  cost_usd    numeric(10, 4) not null default 0,
  detail      jsonb not null default '{}'::jsonb,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index outreach_runs_recent_idx
  on public.outreach_runs (agent, started_at desc);

-- ---------------------------------------------------------------------------
-- Access: the marketing role or the admin, same gate as the hub (100).
-- ---------------------------------------------------------------------------
alter table public.outreach_coaches  enable row level security;
alter table public.outreach_channels enable row level security;
alter table public.outreach_touches  enable row level security;
alter table public.outreach_runs     enable row level security;

create policy "Marketing works the pipeline"
  on public.outreach_coaches for all to authenticated
  using (public.is_admin() or public.is_marketing())
  with check (public.is_admin() or public.is_marketing());

create policy "Marketing works the channels"
  on public.outreach_channels for all to authenticated
  using (public.is_admin() or public.is_marketing())
  with check (public.is_admin() or public.is_marketing());

create policy "Marketing works the touches"
  on public.outreach_touches for all to authenticated
  using (public.is_admin() or public.is_marketing())
  with check (public.is_admin() or public.is_marketing());

create policy "Marketing reads the runs"
  on public.outreach_runs for select to authenticated
  using (public.is_admin() or public.is_marketing());

revoke all on public.outreach_coaches  from anon;
revoke all on public.outreach_channels from anon;
revoke all on public.outreach_touches  from anon;
revoke all on public.outreach_runs     from anon;

grant select, insert, update, delete on public.outreach_coaches  to authenticated;
grant select, insert, update, delete on public.outreach_channels to authenticated;
grant select, insert, update, delete on public.outreach_touches  to authenticated;
grant select on public.outreach_runs to authenticated;
