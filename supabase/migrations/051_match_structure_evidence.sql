-- 051: versioned RTMPose match-structure evidence and first-server authority.
--
-- match_structure contains summarized first-server and persistent player-end
-- evidence. It never replaces the owner's point-level server/game overrides.
-- first_server_source distinguishes replaceable detection from a user choice.

alter table public.matches
  add column if not exists match_structure jsonb,
  add column if not exists first_server_source text
    check (first_server_source in ('user', 'detected'));

-- Every existing value came from the pre-049 owner workflow. Preserve it as
-- authoritative before a worker is allowed to write detected values.
update public.matches
set first_server_source = 'user'
where first_server is not null
  and first_server_source is null;

grant update (first_server, first_server_source)
  on public.matches to authenticated;

comment on column public.matches.match_structure is
  'Versioned RTMPose first-server and persistent player-end evidence. Raw evidence remains separate from user score overrides.';

comment on column public.matches.first_server_source is
  'Authority for first_server: user values are never overwritten by worker detection; detected values may be refreshed.';
