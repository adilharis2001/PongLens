-- Deploy receipt-aware web code BEFORE applying this migration. Older code
-- treats every non-invite job as an admin notice. Do not roll back to it.
-- Existing applicants are not backfilled or emailed again.
alter table public.ios_beta_deliveries drop constraint ios_beta_deliveries_kind_check;
alter table public.ios_beta_deliveries add constraint ios_beta_deliveries_kind_check
  check (kind in ('invite', 'receipt', 'admin_adil', 'admin_anton'));

create or replace function public.initialize_ios_beta_delivery()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_when = 'BEFORE' then
    new.scheduled_at := new.created_at + interval '23 hours';
    return new;
  end if;
  insert into public.ios_beta_deliveries (request_id, kind, recipient, idempotency_key)
  values
    (new.id, 'invite', new.email, 'ios-beta-' || new.id || '-invite'),
    (new.id, 'receipt', new.email, 'ios-beta-' || new.id || '-receipt'),
    (new.id, 'admin_adil', 'adilharis2001@gmail.com', 'ios-beta-' || new.id || '-admin'),
    (new.id, 'admin_anton', 'aber97@gmail.com', 'ios-beta-' || new.id || '-admin-anton');
  return new;
end;
$$;
revoke all on function public.initialize_ios_beta_delivery() from public, anon, authenticated;
