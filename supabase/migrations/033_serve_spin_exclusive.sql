-- 033: "No spin" and sidespin are mutually exclusive.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
-- 032 modelled spin as a base axis (back / top / none) plus a sidespin
-- modifier, intending "none + sidespin" to mean PURE sidespin. On screen it
-- reads as a contradiction — "No spin" and "+ Sidespin" both lit — and
-- nobody should have to know the internal model to trust the chips.
--
-- Pure sidespin is now the sidespin flag on its own with no base, so the
-- contradictory pair has no meaning left and is rejected outright.

-- Existing rows: keep the sidespin (it's the real information) and drop the
-- 'none' base, which is what "pure sidespin" now looks like.
update public.points
   set serve_spin = null
 where serve_spin = 'none'
   and serve_sidespin is true;

-- One shape for "unanswered": null, never false.
update public.points
   set serve_sidespin = null
 where serve_sidespin is false;

alter table public.points
  drop constraint if exists points_serve_spin_side_exclusive;
alter table public.points
  add constraint points_serve_spin_side_exclusive check (
    not (serve_spin = 'none' and serve_sidespin is true)
  );
