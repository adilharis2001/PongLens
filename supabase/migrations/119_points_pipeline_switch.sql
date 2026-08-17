-- 119: the points pipeline switch.
--
-- Which card assembly cuts new matches. The worker reads this at job
-- pickup (worker.py points_pipeline_version, fail-open to v1), so flipping
-- it changes the next upload with no deploy and no restart. 'v2' is the
-- assembly rebuilt against the owner-marked point boundaries (117);
-- worker/points_v2.py carries the measurements.
--
-- Deliberately NOT added to the anon read allow-list (107): the client has
-- no use for it, and a new app_config key is private until a page needs it.
insert into public.app_config (key, value)
values ('points_pipeline', 'v2')
on conflict (key) do update set value = excluded.value;
