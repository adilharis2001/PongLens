# PongLens Email User Name Onboarding Design

## Goal

Require a signed-in user who has no name in Supabase Auth metadata to provide
one before using the authenticated PongLens experience. Google users already
receive a name from their provider and should continue without interruption.

## Current behavior

PongLens reads `user_metadata.full_name`, then `user_metadata.name`, and
finally falls back to the email address. Google populates the name fields, but
passwordless email authentication does not. A first-time email user therefore
lands on the dashboard with their entire email address in the greeting and in
other identity surfaces.

## Approved experience

Show a required, single-screen onboarding step whenever an authenticated user
lacks a non-empty `full_name` or `name` value.

The screen follows the existing PongLens sign-in visual language:

- dark background with the restrained cyan/violet glow
- compact centered card with the PongLens logo above it
- heading: **What should we call you?**
- supporting copy: **We’ll use this across PongLens.**
- one field labeled **Your name**
- primary action: **Continue to PongLens**
- no progress indicator, optional questions, avatar picker, or marketing copy

The form must work cleanly at narrow mobile widths and desktop widths. The
name field receives focus on load. Submission uses a loading state and a short,
non-technical inline error if saving fails.

## Authentication and redirect flow

Create an authenticated `/onboarding` route. The route receives a safe local
`next` path, defaulting to `/dashboard`.

The existing Supabase session middleware becomes the enforcement point:

1. Unauthenticated requests to `/onboarding` are sent to `/login`.
2. Authenticated users with no name who request a protected app route are sent
   to `/onboarding?next=<original path and query>`.
3. Authenticated users with a name never see onboarding.
4. Authenticated users with a name who visit `/onboarding` directly are sent
   to the safe `next` destination.
5. `/onboarding` is excluded from the missing-name redirect rule to avoid a
   loop.

This middleware gate is intentional. Redirecting only after an authentication
callback would allow a user who closed the onboarding tab to return later and
reach the dashboard with the email fallback. Middleware enforcement keeps the
name requirement true until the metadata is actually saved.

Coach-invite and other requested destinations remain intact because the
original protected destination is carried through the onboarding `next`
parameter. External, protocol-relative, authentication, login, and onboarding
destinations are rejected.

## Name storage and display

Save the trimmed name to Supabase Auth:

```ts
await supabase.auth.updateUser({
  data: { full_name: normalizedName },
});
```

Continue using the existing display order throughout PongLens:

1. `user_metadata.full_name`
2. `user_metadata.name`
3. email fallback

No public profile table or migration is needed. Existing dashboard greetings,
coach-sharing functions, note attribution, account identity, match labeling,
and notification helpers already read the Auth metadata fields.

Accept Unicode names and common punctuation. Normalize leading/trailing and
repeated whitespace. Require 1–80 characters after normalization. Do not infer
a name from the email address.

## Account editing

Add a compact **Name** editor to the existing identity card on `/account`.
The initial view remains minimal: show the current display name and an
**Edit** control. Editing reveals the same labeled input and a **Save** action.
On success, refresh the route so the avatar initial and displayed identity
update immediately.

The Account editor uses the same normalization and validation as onboarding.
Google users may edit their displayed name as well; Google authentication still
supplies the initial value.

## Components and boundaries

- `src/lib/auth/profile.ts`
  - normalize and validate a name
  - determine whether Auth metadata contains a usable name
  - construct a safe post-onboarding destination
- `src/lib/auth/profile.test.ts`
  - cover missing metadata, whitespace normalization, length bounds, and unsafe
    destinations
- `src/app/onboarding/page.tsx`
  - authenticate, bypass users who already have a name, and render the themed
    screen
- `src/app/onboarding/NameOnboardingForm.tsx`
  - collect, validate, and persist `full_name`
- `src/app/account/DisplayNameEditor.tsx`
  - edit the same metadata from the Account identity card
- `src/lib/supabase/middleware.ts`
  - enforce onboarding for authenticated users without a name and preserve the
    requested local destination
- `src/app/account/page.tsx`
  - place the name editor in the existing identity card

No database migration, service-role key, new environment variable, or external
provider configuration is required.

## Error handling

- Empty or whitespace-only input: **Enter your name to continue.**
- More than 80 characters: **Keep your name to 80 characters or fewer.**
- Supabase update failure: **We couldn’t save your name. Try again.**
- Missing session while submitting: the next protected request returns to
  `/login`.
- Unsafe or recursive `next` destination: use `/dashboard`.

The form stays on-screen after recoverable errors and never exposes raw
Supabase error text.

## Verification

- Unit-test profile metadata detection, normalization, validation, and safe
  destination handling.
- Verify the middleware redirects a missing-name email user to onboarding while
  allowing a named Google user through.
- Verify onboarding stores `full_name` and returns to the requested safe route.
- Verify Account editing updates the visible name.
- Render onboarding and Account editing at desktop and 390-pixel mobile widths.
- Run authentication tests, placement tests, lint, and the production build.

