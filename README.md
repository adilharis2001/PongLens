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
  Google and passwordless email sign-in via Supabase Auth (`@supabase/ssr`).
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

`npm run dev` reads the Supabase **service-role key** from the macOS Keychain
at launch (item `ponglens-service-role`, account `openclaw` — the same one
the worker uses) rather than from `.env.local`. That key bypasses RLS on the
production database, and this project lives under `~/Desktop`, which is
iCloud-synced; keeping it out of the file keeps it out of iCloud. Without the
Keychain item the variable is simply empty and the routes that need it
(paid-review transitions, the Ask rate limiter) fail closed.

## Audio-impact research

The admin-only desktop labeler at `/research/audio-impacts` reviews one game
point at a time. Watch the full point first, then classify every pink-marked
sound before explicitly finishing and opening the next point.

The classes are Paddle (`P`), Table (`T`), Ball on floor (`F`), Shoe / footstep
(`H`), Shoe squeak (`Q`), Stomp (`S`), Net (`N`), Background court (`B`),
Other (`O`), No clear impact (`X`), and Unsure (`U`). Shoe / footstep means an
ordinary step or non-squeaking shoe movement; Shoe squeak is friction noise;
Stomp is a distinct heavy foot strike.

## Setup from scratch

Full operator runbook (Supabase project, Google OAuth, Vercel, domain,
worker daemon): **`supabase/README-SETUP.md`**.

## Repo map

```
src/app/            pages: landing, /login, /dashboard, /terms, /privacy
src/app/auth/       Google callback + passwordless email confirmation
src/lib/supabase/   browser / server / middleware Supabase clients
supabase/           001_init.sql migration + operator setup runbook
worker/             Mac Studio daemon + launchd plist + setup guide
public/img/         AI-generated marketing imagery
```
