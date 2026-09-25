-- The upload's content check runs on the fast lane.
--
-- 2026-09-25: Adil marked 20 points on a fresh upload (e92439f4) and "Cut
-- the match" refused with "Still checking the video. Try again in a
-- moment." The hand-cut claim waits for content_checked_at (the gate can
-- delete the raw), and the check had sat queued for ten minutes on the main
-- lane behind a 19-minute dead space cut while mac:fast stood idle. A
-- content check is a person-waiting job, the kind the fast lane exists for:
-- a download, twelve frames and one vision call.
--
-- It follows the same switch as re-cuts (app_config.reclip_lane), so
-- setting that to anything but 'fast' puts both back on the main lane.
-- Pulled from production with pg_get_functiondef on 2026-09-25; the only
-- change is content_check in the first branch.
create or replace function public.job_queue_name(p_kind text, p_options jsonb)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_lane text;
  v_match_id uuid;
begin
  if p_kind = 'reclip'
     or p_kind = 'content_check'
     or (p_kind = 'reel' and coalesce(p_options->>'scope', '') like 'v:%')
  then
    select value into v_lane from public.app_config where key = 'reclip_lane';
    if v_lane = 'fast' then
      return 'jobs_fast';
    end if;
    return 'jobs';
  end if;
  if p_kind = 'hand_cut' then
    return 'jobs_hand';
  end if;
  if p_kind in ('placement_generate', 'placement_retry')
     or (p_kind = 'reel' and p_options->>'scope' = 'highlights')
  then
    if coalesce(p_options->>'match_id', '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_match_id := (p_options->>'match_id')::uuid;
      if exists (
        select 1 from public.matches m
         where m.id = v_match_id and m.cut_source = 'manual'
      ) then
        return 'jobs_hand';
      end if;
    end if;
  end if;
  return 'jobs';
end;
$function$;
