# Platform cost dashboard credentials

The dashboard does not need invoice access to estimate costs. PongLens records
anonymous billing dimensions at each successful provider call and prices them
with effective-dated rates in Postgres.

Provider credentials below are optional. When present, the Mac worker fetches
the previous complete UTC day's aggregate provider usage once per day. Those
snapshots appear as a separate reconciliation signal and are never added to
the internal estimated total.

## Required for the internal meter

### Vercel

Add `SUPABASE_SERVICE_ROLE_KEY` to the PongLens Vercel project's Production,
Preview, and Development environments, then redeploy. The server-only cost
meter uses it to call `record_cost_usage`; it is never returned to the browser.

The existing `NEXT_PUBLIC_SUPABASE_URL` remains the database URL.

### Mac worker

No new required secret is needed. The worker writes usage through its existing
direct Postgres connection. Its existing R2 credentials are also used for the
daily account storage snapshot.

## Optional provider reconciliation

Store secrets in macOS Keychain under the existing `openclaw` account:

```sh
security add-generic-password -U -a openclaw -s SERVICE_NAME -w 'VALUE'
```

Environment variables with the names below override Keychain values.

### OpenAI

1. As an OpenAI organization owner, open Organization settings → Admin keys:
   <https://platform.openai.com/settings/organization/admin-keys>
2. Create an organization Admin API key.
3. Store it as Keychain service `ponglens-openai-admin-key`, or set
   `PONGLENS_OPENAI_ADMIN_KEY`.

This key can read the organization Costs API. It is distinct from the normal
project API key used to make model requests.

### Deepgram

1. In the Deepgram Console, select the production project.
2. Create a dedicated API key with the narrow `usage:read` permission.
3. Copy the project's ID from project settings.
4. Store the key as `ponglens-deepgram-usage-key` and the ID as
   `ponglens-deepgram-project-id`, or set:
   `PONGLENS_DEEPGRAM_USAGE_KEY` and `PONGLENS_DEEPGRAM_PROJECT_ID`.

The daily check uses Deepgram's summarized Project Usage endpoint. Deepgram
reports aggregate hours and request counts there; the dashboard's dollar
estimate still comes from internally metered audio duration and the configured
Nova-3 rate.

### Cloudflare R2

1. In Cloudflare, create an account API token.
2. Grant only Account → Account Analytics → Read for the account containing
   PongLens R2.
3. Store it as `ponglens-cloudflare-analytics-token`, or set
   `PONGLENS_CLOUDFLARE_ANALYTICS_TOKEN`.

The account ID comes from the existing `R2_ACCOUNT_ID` /
`ponglens-r2-account` setting. The token reads only aggregate R2 operations and
storage through Cloudflare's GraphQL Analytics API.

### Vercel

1. Create a Vercel access token from Account settings → Tokens.
2. Copy the PongLens team's Team ID from Team settings.
3. Store them as `ponglens-vercel-access-token` and
   `ponglens-vercel-team-id`, or set:
   `PONGLENS_VERCEL_ACCESS_TOKEN` and `PONGLENS_VERCEL_TEAM_ID`.

The FOCUS billing charges API is available to Pro and Enterprise teams. If the
current plan does not expose it, the dashboard records a sanitized error and
continues using internal estimates.

### Supabase

1. Create a fine-grained Management API token with
   `analytics_usage_read` permission for the PongLens project. A personal
   access token also works but has broader account privileges.
2. Copy the project reference from the project URL/settings.
3. Store them as `ponglens-supabase-management-token` and
   `ponglens-supabase-project-ref`, or set:
   `PONGLENS_SUPABASE_MANAGEMENT_TOKEN` and
   `PONGLENS_SUPABASE_PROJECT_REF`.

This records aggregate Auth, Realtime, REST, and Storage request counts. It
does not infer a Supabase dollar amount; add the subscription as a fixed item
in the cost dashboard when desired.

## Activate and verify

Restart the worker after adding Keychain values so its next daily retention
sweep reloads them. The dashboard's Data health section shows each configured
provider's latest successful/error snapshot and time.

No provider credential, bucket name, object key, user ID, email, prompt,
transcript, or file name is written to a cost event or provider snapshot.

## Optional historical backfill

The backfill is dry-run by default. It uses only aggregate storage-ledger
balances, aggregate `ai_usage` counters, a current R2 byte total, and exact
token totals from recognized worker content-check log lines:

```sh
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/backfill_cost_usage.py --start 2026-01-01
```

Review the JSON summary, then run the same command with `--apply` to insert
idempotent `backfill:` events. Repeating `--apply` is safe. Use `--end
YYYY-MM-DD` for an exclusive UTC end date.

Old AI counters prove that a request was budgeted, but do not prove its token
usage or even that the provider completed it. They are therefore recorded as
unpriced, assumed request counts. The backfill never invents tokens, video
duration, or compute time from job/match totals.

Useful references:

- OpenAI Costs API: <https://platform.openai.com/docs/api-reference/usage/costs>
- Deepgram usage: <https://developers.deepgram.com/docs/using-logs-usage>
- Cloudflare R2 analytics: <https://developers.cloudflare.com/r2/platform/metrics-analytics/>
- Vercel REST API: <https://vercel.com/docs/rest-api>
- Supabase Management API usage: <https://supabase.com/docs/reference/api/usage>
