# Platform Cost Threshold Alerts

## Goal

Email the PongLens owner whenever internally metered month-to-date platform
spend crosses another $100 boundary.

## Threshold semantics

- Alert thresholds are $100, $200, $300, and every additional $100.
- The threshold ladder resets at 00:00 UTC on the first day of each month.
- If spend jumps across multiple thresholds between checks, each crossed
  threshold receives its own alert.
- Spend uses the same internally metered and priced basis as the admin
  dashboard, including effective-dated fixed costs.
- Provider reconciliation snapshots are excluded to prevent double counting.
- Synthetic cloud compute is excluded because it is a scenario estimate.

## Architecture

Add a private cost-alert delivery ledger keyed by UTC month and threshold. A
database function calculates the current month-to-date total, creates any
missing delivery rows, and returns pending alerts. The long-lived worker calls
the function approximately once per minute and sends pending emails through
the existing Resend integration.

The delivery ledger is the idempotency boundary. Worker restarts and repeated
checks cannot create duplicate threshold rows. A successful email marks its row
sent. A failed email remains pending and is retried on a later check.

## Email

Send to `adilharis2001@gmail.com` using the existing PongLens sender. Each
message includes:

- The threshold crossed.
- Current month-to-date estimated spend.
- The UTC month.
- Aggregate vendor totals.
- A link to the owner-only admin dashboard.

The email itself remains part of normal Resend usage metering.

## Operations and safety

- Alert evaluation must never block video processing.
- Missing Resend credentials or transient delivery failures are logged and
  retried without crashing the worker.
- Alert tables and functions are private to trusted server callers.
- The deployed default interval is $100. The schema stores the threshold on
  each delivery so future configurability does not rewrite history.

## Verification

- Unit tests cover threshold generation, monthly reset, multi-threshold jumps,
  duplicate suppression, successful delivery, and retry after failure.
- Migration tests verify private access and the unique monthly threshold key.
- A production-safe check confirms no alert is created below $100.
- No real threshold email is sent during deployment verification.

