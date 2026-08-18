# PongLens iOS backend integration reference

Extracted 2026-08-17 from the web codebase. The iOS app talks to the same backend:
Supabase `https://pdycinmyfnritemrsfjf.supabase.co` (anon key is public by design;
RLS protects rows) and the Next API at `https://www.ponglens.com` (never the apex,
never *.vercel.app).

## Auth

- PKCE everywhere (`@supabase/ssr` hard-sets it). supabase-swift stores the session
  in the Keychain.
- Magic link: the Supabase email template links to
  `https://www.ponglens.com/auth/confirm?next=…&token_hash=…&type=email`.
  Native sign-in = get `token_hash` and call `auth.verifyOTP(type: .email, tokenHash:)`.
  Options: universal link on `/auth/confirm`, or a custom `emailRedirectTo`
  (must be added to the Supabase redirect allow-list).
- Google OAuth: `signInWithOAuth(provider: .google)` via ASWebAuthenticationSession.
- Onboarding gate (mirror in app): needs `user_metadata.full_name`/`name` non-empty
  AND a `player_profiles` row, else route to onboarding.
- Roles: admin = `rpc("is_admin")`. Coach-ish = coach_profiles row OR accepted
  coach_links OR review_orders as student. True coach = coach_profiles row.
- Match visibility = `has_match_access(match_id)`: owner or accepted coach link
  (all-matches or scoped).

## The API auth blocker (fix in web repo)

Every `/api/*` route builds its Supabase client from `src/lib/supabase/server.ts`,
cookies only — a bearer `Authorization` header gets 401 everywhere. Fix: add a
header fallback in that one file (all ~40 routes inherit it): when an
`Authorization` header is present, pass it through
`global: { headers: { Authorization } }` so `auth.getUser()` resolves from the JWT.
Additive; no change for cookie callers. Until deployed, the app can do direct
PostgREST reads/writes and `/api/share/media`, but not upload/process/media-url/
journal saves/transcribe/reels/share/commerce.

## Direct Supabase access (works today via supabase-swift)

`src/lib/types.ts` is the schema contract for Codable models (Match, Point, Note,
Lesson, Tag, NoteFeedRow, AppNotification, Job, Placement v1/v2/v3).

- `matches`: select owner-or-coach; update is COLUMN-SCOPED for authenticated:
  opponent_name, match_type, user_side, player_near_name, player_far_name,
  first_server, first_server_source, venue, placement_flagged. Nothing else.
- `points`: select via match access; UPDATE column-scoped (42501 outside the list):
  confirmed_winner, confirmed_how, starred, server, t0, t1, deleted,
  server_override, is_let, tight_start, tight_end, game_end_override, direction,
  serve_spin, serve_sidespin, serve_length, loss_reasons, misread_kind,
  placement_flagged, scored_at_cut_s, serve_start_at_cut_s, serve_start_meta
  (admin-only in UI), game_winner_override.
  Scorekeeper writes `{confirmed_winner, confirmed_how, is_let}` as ONE patch
  (DB constraint forbids is_let + winner). Split/merge via
  rpc split_point / merge_points / unsplit_point.
- `point_boundaries` view: read-only, research-oriented.
- `notes`: insert own; select = match viewers. Feed: `rpc("note_feed", {p_limit})`.
- `lessons` (journal): read direct; WRITES go through /api/lesson + /api/journal-entry
  (distillation + Recollect side effects).
- `tags`/`point_tags`/`entry_tags`, `focus_points`: direct CRUD.
  Aggregates: rpc tag_stats, tagged_points.
- `notifications`: select; update read_at only.
- `jobs`: select own; library polls queued/processing, excluding kind=content_check.
- `app_config` allow-listed keys (107): support_email, commerce_enabled,
  coach_reviews_enabled, review_* fee keys, minute_packs, storage_packs,
  sponsored_packs, sponsored_free_credits, free_processing_minutes,
  default_storage_bytes. Read commerce_enabled at launch — upload UX branches on it.
- Key RPCs: my_storage_state(), my_processing_state(), current_billing_mode(),
  note_feed, tag_stats, tagged_points, match_note_authors, coach_players,
  player_coach_links, cancel_queued_processing(p_job_id), is_admin, is_qa,
  student_review_orders, review_order_detail, accept_coach_invite,
  resolve_share_link/starred/tagged/points (anon-callable).
- Stats reads points with a narrow column list, chunked 50 match ids, paged 1000
  rows (PostgREST cap).

## API routes (all cookie-auth today; bearer after the fix)

- POST /api/upload-url: {action:"create",fileSize,contentType} → {bucket,key,uploadId};
  {action:"sign-part",key,uploadId,partNumber} → {url} (PUT raw bytes, capture ETag,
  16 MiB parts, ≤6 GB); {action:"list-parts"} for resume; {action:"complete",key,
  uploadId,parts,register:{durationS,originalName,capturedAtMs,opponent,venue,
  matchType,userSide}} → {ok,matchId} (match row born here in commerce mode);
  {action:"abort"}. 429 carries an exact user-facing sentence.
- POST /api/process: {matchId,trimStartS?,trimEndS?,points,placement,strictness}
  — spends minutes, claims processing atomically.
- POST /api/media-url: {thumbs:[ids≤100]} → {urls}; {matchId,pointId} → {url};
  {matchId,preview:true} for the inline cut; {matchId,reel:true,scope};
  {lessonId,image:true}; {tagReel:id}. Signed 3600 s. Use inline variants for
  AVPlayer.
- POST /api/delete-match: {matchId,action:"preview"|"delete"} (owner only).
- POST /api/lesson: {transcript,kind:"lesson"|"practice",coachName?,imagePath?,
  summarize?} → {id,status,takeaways}; PATCH to edit. DELETE /api/journal-entry.
- POST /api/journal-ask: {question} → {answer:[{text,sourceIds}],sources,coverage}
  or {refused}; rate-limited server-side.
- POST /api/journal-ocr: multipart pages (≤6 × 8 MB) → per-page text; 40/day cap.
- POST /api/transcribe: multipart audio ≤10 MB → {audio_path,transcript,url}.
- POST /api/entry-image (moderated, 30/day), /api/note-image: multipart → path.
- POST /api/reel {matchId,scope,showScore}, /api/tag-reel {tagId} → status.
- POST /api/share {matchId,pointId?|kind:"starred"|tagId} → {url,id,token} (owner
  only); /api/share/revoke. GET /api/share/media?token&pointId — NO auth, token is
  the credential, 900 s URLs.
- POST /api/import-url: YouTube import.
- Billing/reviews checkout return Stripe URLs — hand off to web, not native.
- Error dialects: old routes {error:"sentence"}, new commerce/review {code:"stable"}.

## Media

Two private R2 buckets; every byte behind presigned GETs (1 h / 15 min share).
Progressive MP4, NO HLS. Paths in Postgres as r2://bucket/key. Batch thumbs 100 at
a time. Re-request URLs on expiry; a paused AVPlayer past 1 h needs a fresh URL.
Small images/audio go as multipart POSTs (server writes to R2), not presigned PUT.

## Realtime

None in the web app — polling: library 10 s active / 30 s idle; home 10 s; bell 60 s;
reel 5 s; placement 10 s; upload lock 8 s. Supabase Realtime publication is NOT
configured in migrations — verify before relying on it; otherwise poll at the same
cadences.

## Never in the app

Service-role key, R2 credentials, OpenAI/Deepgram/Stripe keys. Only the Supabase
URL + anon key and the API base URL ship in the binary.
