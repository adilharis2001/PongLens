-- 169 — an invite link previews as an invitation, not as an advert.
--
-- Adil, 2026-09-04: sharing a coach invite showed the generic card, "a
-- performance hub for competitive table tennis". The first thing a coach
-- sees of PongLens is that preview in their messages, and it says nothing
-- about who is asking or what for.
--
-- Both invite pages read their data through functions only `authenticated`
-- may call, which is right for the pages — they reveal a name to somebody
-- who has signed in. A link preview has no session at all: WhatsApp and
-- iMessage fetch it as a stranger. So the preview needs its own reads.
--
-- WHAT THESE DELIBERATELY DO NOT DO. They answer for a LIVE invite only —
-- pending and unclaimed, or not yet revoked. A spent or withdrawn link
-- falls back to the generic card rather than naming anybody, so a token
-- that has done its job stops talking. They return a name and a scope and
-- nothing else: no match titles, no counts, no email. And the name comes
-- from _name_or, never _display_name, because _display_name falls back to
-- the email local part and this is read by whoever holds the link.
--
-- The precedent is coach_page (the storefront's own OG card) and
-- resolve_share_link, both anon-callable for the same reason: the picture
-- in somebody's messages cannot ask them to log in first.
--
-- BOTH PARAMETERS ARE p_token, and that is not a style choice.
-- coach_student_invites has a column called `token`, so a parameter of
-- the same name is shadowed by it: `where i.token = token` compiles fine
-- and means `i.token = i.token`, which is true of every row. The first
-- cut of this shipped that way and a token that existed nowhere came back
-- with a real coach and student's names. Every other token-taking
-- function in this schema already uses the p_ prefix; this is why.

-- ---------------------------------------------------------------------------
-- A player inviting a coach.
-- ---------------------------------------------------------------------------
drop function if exists public.coach_invite_preview(uuid);
create function public.coach_invite_preview(p_token uuid)
returns table (
  inviter_name text,
  -- What the player calls them, when they named the invite (164). Lets
  -- the card open with the coach's own name.
  invited_name text,
  scope text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(btrim(public._name_or(u.*, 'A player')), ''), 'A player'),
    pc.display_name,
    case
      when cl.scope_match_id is not null then 'match'
      when cl.all_matches then 'all'
      else 'selected'
    end
  from public.coach_links cl
  join auth.users u on u.id = cl.player_id
  left join public.player_coaches pc
    on pc.invite_id = cl.id and pc.archived_at is null
  where cl.invite_token = p_token
    and cl.status = 'pending'
    and cl.coach_id is null
  limit 1;
$$;

revoke execute on function public.coach_invite_preview(uuid) from public;
grant execute on function public.coach_invite_preview(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- A coach inviting a student. The same rules from the other side.
-- ---------------------------------------------------------------------------
drop function if exists public.student_invite_preview(uuid);
create function public.student_invite_preview(p_token uuid)
returns table (
  inviter_name text,
  -- The roster row this invite was minted against, when the coach typed
  -- a name for them before sending it.
  invited_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(btrim(public._name_or(u.*, 'A coach')), ''), 'A coach'),
    cs.display_name
  from public.coach_student_invites i
  join auth.users u on u.id = i.coach_id
  left join public.coach_students cs
    on cs.id = i.student_id and cs.archived_at is null
  where i.token = p_token
    and i.revoked_at is null
  limit 1;
$$;

revoke execute on function public.student_invite_preview(uuid) from public;
grant execute on function public.student_invite_preview(uuid) to anon, authenticated;
