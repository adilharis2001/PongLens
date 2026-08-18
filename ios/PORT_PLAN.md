# PongLens iOS port plan

The iOS app is a native SwiftUI port of the player-facing web app, plus one
iOS-only feature: recording footage directly in the app. Same Supabase backend,
same API routes, same copy. Working references in `ios/docs/`:

- `design-system.md` — colors, type, components (from the web Tailwind theme)
- `screen-inventory.md` — every screen, layout, copy, nav mapping
- `backend-integration.md` — auth recipe, table access map, API contracts, media
- `behavioral-spec.md` — match player / scorekeeper / journal / upload, verbatim

## Scope decisions

- Player-facing surfaces only. Admin, research, testing, marketing stay web.
- Coach AUTHORING (offerings/profile editors, finding editor) defers to the web
  in v1; the Coaching hub, orders list and student order flow are native.
- Purchases (packs, review checkout) hand off to the web — App Store IAP rules
  make native Stripe checkout for digital services a rejection risk.
- Marketing pages (/coaches, /coach/[handle], /terms, /privacy) open in Safari.
- Copy is reused verbatim from the web. No new copywriting.

## Architecture

- SwiftUI, iOS 26, dark-only (`.preferredColorScheme(.dark)`).
- supabase-swift for auth (PKCE, Keychain), PostgREST, RPCs.
- `APIClient` for the Next routes at https://www.ponglens.com with
  `Authorization: Bearer <access token>` — requires the small server-side
  fallback in `src/lib/supabase/server.ts` (additive; see backend doc).
- AVPlayer for all playback (progressive MP4 via presigned URLs, 1 h expiry —
  refresh on demand). AVFoundation capture for Record mode.
- Polling at the web's cadences; no realtime dependency.
- Models mirror `src/lib/types.ts`.

## Build order

1. ✅ Project setup, first build, simulator pipeline
2. ✅ Research + this plan
3. Foundation: theme (done), Supabase client, models, tab skeleton, arena chrome
4. Auth: magic link + session persistence + dev sign-in (demo account)
5. Dashboard
6. Matches library
7. Match detail: raw view + processed view + watch player
8. Scorekeeper (Keep score) — after the player, it builds on the same takeover
9. Journal
10. Stats
11. Learn
12. Coaching hub (player+coach views) + orders (student side)
13. Upload from photo library
14. Record mode (native-only feature)
15. Account, feedback, onboarding, share-link viewing, notifications
16. Polish: motion, haptics, app icon, full walkthrough

Each screen is verified in the simulator against the web app side by side
before moving on.
