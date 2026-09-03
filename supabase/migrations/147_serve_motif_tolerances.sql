-- How much slack a serve's two bounces get around the table's edge, and how
-- close together two readings have to be before they are treated as one
-- serve. Both are read per job by worker.serve_motif_settings and passed to
-- the points pipeline, so retuning either is one UPDATE with no deploy and
-- no restart.
--
-- WHY THESE NUMBERS. A serve is accepted only when both of its bounces land
-- on the playing surface, and "on the surface" is known only to within the
-- error the pipeline carries: the homography maps the CENTRE of the ball,
-- which sits a radius above the plane, and the quad's own corners are a few
-- pixels out. The old 0.15 m was smaller than that error, so real serves
-- were thrown away before any of the six pair rules ran — 47 of 914 cards
-- on the review corpus lost their anchor to it.
--
-- The two settings ship together and must be changed together. Widening the
-- surface alone lets 7 mid-rally readings through on the same corpus; the
-- merge is what caps them at 4. The merge alone drops 25 detections and one
-- card's anchor and buys nothing, because most of what it merges was already
-- inside a single card and a card is only ever anchored once.
--
-- Measured over 11 matches by replaying the rule on the stored ball tracks,
-- and judged against a person watching every card the change adds: 48 right,
-- 4 wrong, 555 anchored cards becoming 602. No match changed assembler route.
-- Record: docs/superpowers/specs/2026-08-28-serve-surface-slack-design.md
--
-- NOT added to the app_config public allow-list (107). Nothing on a public
-- page renders either value, and a key stays private until someone has a
-- reason to publish it.
--
-- Rollback is this, and a worker restart is not needed:
--   update public.app_config set value = '0.15' where key = 'serve_surface_pad_m';
--   update public.app_config set value = '1.5'  where key = 'serve_merge_s';
--
-- Forward-only and safe to re-run. DO NOTHING rather than an upsert on
-- purpose: this seeds a setting, and a replayed migration must not quietly
-- undo a rollback someone made deliberately in the dashboard.

insert into public.app_config (key, value) values
  ('serve_surface_pad_m', '0.45'),
  ('serve_merge_s', '2.5')
on conflict (key) do nothing;
