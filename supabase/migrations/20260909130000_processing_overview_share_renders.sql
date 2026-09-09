-- The processing page is the only place anyone can see what the workers are
-- doing, and it falls behind them silently. The lesson worker now serves a
-- second queue: the copies of a recap with the words burnt in, which a coach
-- asks for and then waits on. It is not a second lane, because the same
-- process serves it in the same poll loop, so it gets no worker row of its
-- own; a row would claim a process that can be separately alive or dead.
-- What an operator needs is what that one worker is doing and what is waiting.
alter function public.admin_processing_overview()
  rename to admin_processing_overview_pre_share_render_20260909;

create or replace function public.admin_processing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  overview jsonb;
  lesson jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  overview := public.admin_processing_overview_pre_share_render_20260909();
  lesson := coalesce(overview->'lesson', '{}'::jsonb) || jsonb_build_object(
    'share_queued', (
      select count(*) from public.lesson_share_renders where status = 'queued'
    ),
    'share_failed', (
      select count(*) from public.lesson_share_renders where status = 'failed'
    ),
    'share_stage', (
      select stage from public.lesson_share_renders
       where status = 'processing'
       order by updated_at desc
       limit 1
    ),
    'share_oldest_queued_at', (
      select min(created_at) from public.lesson_share_renders where status = 'queued'
    )
  );
  return jsonb_set(overview, '{lesson}', lesson, true);
end;
$$;

revoke all on function public.admin_processing_overview() from public, anon;
grant execute on function public.admin_processing_overview() to authenticated;
