# Beta allowances verification and release

Implementation lives on codex/beta-allowances. No production settings, balances, messages, payments or running workers were changed during implementation.

## Verified

- SQL integration tests in supabase/tests/beta_allowances.sql, using a separate local database: both pack types blocked while purchases are paused; purchases allowed when enabled again; metering remains enabled after both switch directions; exhausted minute balance rejects processing; duplicate request returns the same ID; players cannot grant themselves allowances, change the switch, insert forged requests or read the admin roster; both administrators receive notifications and email queue records; Anton can grant minutes/storage; already-decided and mismatched requests cannot grant again; expected resulting balances and player notifications.
- Commerce, email, payment/review and admin navigation test suites.
- Full npm run build including type checking and linting. Existing unrelated lint warnings remain.
- iOS simulator build via xcodebuild. Existing unrelated Swift warnings remain.
- Browser interaction with mocked data: player submits a request and sees pending state; admin selects an incoming request and grants to that player; no horizontal overflow at 393×660; desktop layout at 1440×900.
- Visual inspection of /tmp/ponglens-beta-player-mobile.png, /tmp/ponglens-beta-admin-mobile.png and /tmp/ponglens-beta-admin-desktop.png.

## Release sequence

1. Recheck the migration number against other branches before merging.
2. Apply 172_beta_allowances.sql in a transaction, and deploy this web revision together. Purchases start disabled and processing metering stays enabled. Existing balances are preserved.
3. As an administrator, POST /api/admin/purchases with {"enabled":false} once during rollout. This closes any previously opened unpaid Stripe checkout sessions. A cleanupFailed response requires retrying; do not announce closure until it is false.
4. Check Account on the production web app: no minute/storage pack tiles, both request buttons present. Check Admin → Purchases and allowances: switch Off, requests list, searchable players, current allowances.
5. Ship the iOS build through the normal TestFlight release process. Older iOS builds remain unable to buy while iap_enabled is off; the native request form requires the new build.
6. Use a designated test account to request each resource and verify notifications reach both administrator accounts, then have one administrator approve and verify the new balance. Production email delivery, real Stripe session expiry and on-device native form submission have not been exercised during this task.

## Boundaries

- The purchase switch covers storage and processing packs. Paid coach reviews and their included processing allowance are unchanged.
- iOS purchases still also require the existing iap_enabled launch flag and configured Apple products. The new global switch can block all new purchases regardless of that flag.
- Already-paid purchases still fulfill; disabling new sales must not discard a payment already collected.
- Storage checks retain the existing accounting model: raw and cut videos count, and active review-order holds remain separate. This task does not introduce a reservation system for simultaneous uploads or change worker output-size accounting.
- Allowance requests and approvals are recorded in the database. Administrators receive in-app notifications plus email; players receive an in-app decision notification. The existing daily email sweep retries failed admin email deliveries.
