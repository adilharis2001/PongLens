# PongLens

AI table-tennis match analysis — upload a match video, get back a cut of
pure play. Placement maps, spin fingerprints, and match reports are coming.

Live at [ponglens.com](https://ponglens.com).

## Architecture

```
Browser ── tus resumable upload ──> Supabase Storage (uploads/, private)
   │                                        │
   └── insert into jobs (RLS) ──> trigger ──> pgmq queue 'jobs'
                                              │
                    Mac Studio worker ── pgmq.read() pulls job
                    (worker/worker.py)   downloads video
                                         runs TTVid dead-space pipeline
                                         uploads result
                                              │
Browser <── signed URL download ──── Supabase Storage (results/, private)
```

- **Web app** — Next.js 15 (App Router) + Tailwind 4, deployed on Vercel.
  Google sign-in only, via Supabase Auth (`@supabase/ssr`).
- **Queue** — `pgmq` inside the same Supabase Postgres; a trigger enqueues a
  message for every inserted job. No extra infrastructure.
- **Worker** — pull-based Python daemon on the operator's Mac Studio. Nothing
  connects into the Mac; it polls outward. See `worker/README.md`.
- **Polling** — the dashboard polls jobs every 10 s (v1 simplicity). Upgrade
  path: Supabase Realtime `postgres_changes` on the jobs table.

## Local development

```bash
cp .env.example .env.local   # fill in your Supabase project values
npm install
npm run dev
```

## Setup from scratch

Full operator runbook (Supabase project, Google OAuth, Vercel, domain,
worker daemon): **`supabase/README-SETUP.md`**.

## Repo map

```
src/app/            pages: landing, /login, /dashboard, /terms, /privacy
src/app/auth/       OAuth callback route handler
src/lib/supabase/   browser / server / middleware Supabase clients
supabase/           001_init.sql migration + operator setup runbook
worker/             Mac Studio daemon + launchd plist + setup guide
public/img/         AI-generated marketing imagery
```
