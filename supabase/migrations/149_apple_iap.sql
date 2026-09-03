-- 149 — buying minutes and storage through Apple's in-app purchase.
--
-- The iOS app cannot send people to Stripe (App Store rule 3.1.1), so the
-- phone buys through Apple instead. What it must NOT do is grow a second
-- way of turning money into balance: platform_purchases plus
-- fulfill_platform_purchase is already the one place a pack becomes
-- minutes or gigabytes, and Stripe and the test gateway both go through
-- it. Apple becomes a third door into that same room.
--
-- So this migration adds only what is genuinely Apple-shaped:
--
--   * apple_transaction_id, the id Apple gives a completed purchase. It
--     is UNIQUE, and that index is the whole replay defence: the same
--     signed transaction sent twice — by a retry, a relaunch, or someone
--     replaying a captured request — collides and grants nothing the
--     second time. Verifying the signature proves the receipt is real,
--     not that it is fresh; only the database can answer freshness.
--
--   * fulfill_apple_purchase, which stamps that id and then calls the
--     existing fulfil. It deliberately does not repeat the granting
--     logic. A rule written twice is a rule that will be wrong in one
--     place: the same mistake mirrored maps and mirrored placement code
--     through this project already.

alter table public.platform_purchases
  add column if not exists apple_transaction_id text;

-- 'refunded' is new. Apple refunds on its own authority and tells us
-- afterwards, which Stripe purchases never did — the status column was
-- written when 'paid' was the end of every story.
alter table public.platform_purchases
  drop constraint if exists platform_purchases_status_check;
alter table public.platform_purchases
  add constraint platform_purchases_status_check
  check (status in ('pending', 'paid', 'refunded'));

-- Partial, so the Stripe rows (all null here) do not collide with each
-- other. Unique, so an Apple transaction can be spent exactly once.
create unique index if not exists platform_purchases_apple_txn_idx
  on public.platform_purchases (apple_transaction_id)
  where apple_transaction_id is not null;

comment on column public.platform_purchases.apple_transaction_id is
  'Apple''s transactionId for an in-app purchase. Unique: the replay guard.';

/**
 * Grant an Apple purchase, exactly once.
 *
 * Returns true when this call is what granted, false when there was
 * nothing to do — already fulfilled, unknown id, or a transaction id that
 * has been seen before. False is a normal answer on a retry and the
 * caller should treat it as success, exactly as the Stripe path does.
 *
 * Service role only. The signature check happens in the route before this
 * is called; the database's job is to make sure a verified receipt cannot
 * be spent twice, which the unique index does under concurrency in a way
 * a read-then-write in application code could not.
 */
create or replace function public.fulfill_apple_purchase(
  p_purchase_id uuid,
  p_transaction_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stamped integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_transaction_id is null or btrim(p_transaction_id) = '' then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  -- Claim the transaction id onto this pending row. A second delivery of
  -- the same transaction raises unique_violation and is answered false,
  -- so a retry is safe and silent.
  begin
    update public.platform_purchases
       set apple_transaction_id = p_transaction_id
     where id = p_purchase_id
       and status = 'pending'
       and apple_transaction_id is null;
    get diagnostics v_stamped = row_count;
  exception when unique_violation then
    return false;
  end;

  if v_stamped = 0 then
    return false;  -- already fulfilled, already stamped, or unknown
  end if;

  -- The one granting path, shared with Stripe. No Stripe ids to record.
  return public.fulfill_platform_purchase(p_purchase_id, null, null);
end;
$$;

revoke execute on function public.fulfill_apple_purchase(uuid, text)
  from public, anon, authenticated;

/**
 * Take an Apple purchase back after a refund.
 *
 * Apple refunds without asking us, and tells us afterwards through a
 * server notification. The grant has to come back or a refunded person
 * keeps the minutes. Reversing entries rather than deleting: the ledger
 * stays an append-only account of what happened, so a balance can always
 * be explained by reading it forwards.
 *
 * Idempotent on status, so a redelivered notification is harmless.
 */
create or replace function public.refund_apple_purchase(
  p_transaction_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.platform_purchases%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.platform_purchases
     set status = 'refunded'
   where apple_transaction_id = p_transaction_id
     and status = 'paid'
   returning * into v_p;
  if not found then
    return false;
  end if;

  if v_p.kind = 'minute_pack' then
    insert into public.processing_ledger
      (user_id, minutes, kind, funding, billing_mode, purchase_id, note)
    values (v_p.user_id, -v_p.minutes, 'refund', 'personal',
            v_p.billing_mode, v_p.id, 'Refunded: ' || v_p.title);
  elsif v_p.kind = 'storage' then
    -- Storage is an entitlement with an expiry rather than a running
    -- total, so it ends now instead of being negated.
    update public.storage_entitlements
       set expires_at = now()
     where purchase_id = v_p.id and expires_at > now();
  elsif v_p.kind = 'sponsored_pack' then
    insert into public.sponsored_credit_ledger
      (coach_id, credits, kind, billing_mode, purchase_id, note)
    values (v_p.user_id, -v_p.credits, 'refund', v_p.billing_mode,
            v_p.id, 'Refunded: ' || v_p.title);
  end if;

  return true;
end;
$$;

revoke execute on function public.refund_apple_purchase(text)
  from public, anon, authenticated;

-- The kill switch, read at the top of the iOS purchase UI and enforced in
-- the route. Off until the whole path has been walked on a real device.
insert into public.app_config (key, value)
values ('iap_enabled', 'off')
on conflict (key) do nothing;

-- The app has to know whether to draw the buy rows, so iap_enabled joins
-- the anon allow-list (107). Deliberate: a new key is private until
-- someone adds it, and this one is a feature flag with nothing secret in
-- it, sitting beside commerce_enabled which it works with.
drop policy if exists "Public app config is readable" on public.app_config;
create policy "Public app config is readable"
  on public.app_config for select
  using (key = any (array[
    'support_email', 'commerce_enabled', 'coach_reviews_enabled',
    'review_included_minutes', 'review_fee_mode', 'review_fee_percent',
    'review_fee_fixed_cents', 'minute_packs', 'storage_packs',
    'sponsored_packs', 'sponsored_free_credits', 'free_processing_minutes',
    'default_storage_bytes', 'placement_serves_only', 'instagram_sharing',
    'instagram_render', 'iap_enabled'
  ]));
