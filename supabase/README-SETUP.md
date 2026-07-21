# PongLens — Supabase & deployment setup

Everything the operator needs to take this repo from zero to live at
ponglens.com. Steps are ordered; do them top to bottom.

## 1. Create the Supabase project

1. Go to https://supabase.com/dashboard -> **New project**.
2. Name: `ponglens`. Pick a region close to you (the Mac Studio pulls videos
   from here, so a nearby region keeps transfers fast). Choose a strong
   database password and save it — the worker needs it for `DATABASE_URL`.
3. Wait for provisioning, then note from **Project Settings -> API**:
   - Project URL: `https://<ref>.supabase.co`
   - `anon` public key
   - `service_role` key (keep secret — worker only)

## 2. Run the migration

1. Open **SQL Editor** in the dashboard.
2. Paste the entire contents of `supabase/migrations/001_init.sql` and run it.
3. Verify:
   - **Table Editor** shows `jobs` with RLS enabled.
   - **Storage** shows private buckets `uploads` and `results`.
   - SQL: `select * from pgmq.metrics('jobs');` returns a row.

(Alternative: `supabase link --project-ref <ref>` then `supabase db push`.)

## 3. Enable Google sign-in

### 3a. Google Cloud Console

1. https://console.cloud.google.com -> create (or pick) a project, e.g.
   `ponglens`.
2. **APIs & Services -> OAuth consent screen**: External, app name
   `PongLens`, support email, and add your domain `ponglens.com`. Publish the
   app (or keep it in testing and add your Google account as a test user
   while developing).
3. **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**:
   - Application type: **Web application**
   - Name: `PongLens (Supabase)`
   - Authorized JavaScript origins:
     - `https://ponglens.com`
     - `http://localhost:3000`
   - Authorized redirect URIs (this is the important one):
     - `https://<ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client Secret**.

### 3b. Supabase dashboard

1. **Authentication -> Providers -> Google**: enable, paste Client ID and
   Client Secret, save.
2. **Authentication -> URL Configuration**:
   - Site URL: `https://ponglens.com`
   - Additional redirect URLs:
     - `http://localhost:3000/auth/callback`
     - `https://ponglens.com/auth/callback`

## 4. Environment variables

Locally:

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

On Vercel (**Project -> Settings -> Environment Variables**, all
environments):

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |

The service-role key is **never** set on Vercel — only the Mac Studio worker
uses it, from the macOS Keychain.

## 5. Deploy to Vercel + point the domain

1. Push this repo to GitHub, then **Vercel -> Add New Project -> Import** it.
   Framework auto-detects as Next.js; no special settings needed.
2. After the first deploy, **Project -> Settings -> Domains** -> add
   `ponglens.com` (and `www.ponglens.com`, redirecting to the apex).
3. At your DNS registrar, follow Vercel's instructions (usually an `A` record
   `76.76.21.21` for the apex and a `CNAME cname.vercel-dns.com` for `www`).
4. Every future `git push` to `main` auto-deploys.

## 6. Resumable uploads (tus) note

The dashboard uploads with tus-js-client against the endpoint:

```
https://<ref>.supabase.co/storage/v1/upload/resumable
```

Supabase also exposes a dedicated storage hostname
(`https://<ref>.storage.supabase.co/upload/resumable`); both work. If you
ever switch the app to the dedicated hostname, change the `endpoint` in
`src/app/dashboard/UploadCard.tsx`. Chunk size must stay exactly 6 MB — that
is a Supabase requirement, not a preference.

## 7. Start the worker

Follow `worker/README.md` on the Mac Studio. Nothing processes until the
worker is running.

## 8. 30-day upload cleanup (matches the Privacy Policy)

The privacy policy promises original uploads are deleted after 30 days. The
simplest honest implementation: the worker script already knows how to talk
to Storage with the service role, and `worker/worker.py` runs a cleanup pass
on startup and then daily — no extra setup needed as long as the worker is
running. If you ever want it database-driven instead, a `pg_cron` job can
delete rows from `storage.objects`, but files are best removed via the
Storage API, so the worker-side cleanup is the recommended path.

## Adding paid tiers later

The schema and app were shaped so payments bolt on without a rewrite:

1. **Stripe**: add Stripe Checkout + a webhook route (`/api/stripe/webhook`)
   that upserts into a `subscriptions` table (stub is commented at the bottom
   of `001_init.sql`, together with a `plans` table).
2. **Quota enforcement in RLS**: replace the permissive jobs INSERT policy
   with one that counts the user's jobs this month against
   `plans.monthly_quota` and rejects when exceeded. Because inserts go
   through RLS (the app uses the anon key), enforcement is server-side for
   free.
3. **Feature gating via `jobs.kind`**: today every job is `deadspace_cut`.
   Premium analyses (placement maps, spin reports) become new `kind` values;
   the INSERT policy checks `kind = any(plan.allowed_kinds)`. The worker
   already receives `kind` in the queue message and can branch per kind.
4. **UI**: the pricing section on the landing page becomes a real plan
   picker; the upload card reads the user's plan to show remaining quota.
