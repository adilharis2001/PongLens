# Provider Cost Reconciliation UI

## Goal

Give the PongLens owner one admin-only view of platform-wide variable costs without exposing per-user or per-match attribution.

## Behavior

- Internal usage meters remain the source of truth for estimated platform spend.
- Provider usage APIs act as reconciliation checks and are never added to internal estimates.
- Provider checks show:
  - OpenAI reported spend and sync time.
  - Deepgram requests and billable audio.
  - Cloudflare R2 storage, objects, and operations.
  - Supabase aggregate Auth, REST, Realtime, and Storage activity.
  - Resend as an internal recipient-count meter.
  - Vercel only when a provider snapshot is available; Hobby accounts do not require a team key.
- Provider checks refresh on the worker's daily reconciliation cycle, so they can lag provider activity.
- The synthetic compute card remains a scenario estimate based on measured worker runtime and adjustable cloud-worker assumptions. It is excluded from actual platform spend.
- The entire Platform costs section appears at the bottom of the admin page, after storage and quota administration.

## Reliability

- Fix the Supabase Management API interval to the supported `1day` value.
- Show provider sync failures without breaking the rest of the admin portal.
- Keep provider-reported data visually distinct from internal cost estimates to prevent double counting.

