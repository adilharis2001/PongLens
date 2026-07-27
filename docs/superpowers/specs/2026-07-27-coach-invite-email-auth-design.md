# Coach Invite Email Authentication Design

## Goal

Preserve the coaching-invite journey when an invited coach chooses passwordless
email authentication. A first-time email coach must move through:

1. Open the coaching invite.
2. Choose email sign-in.
3. Open the secure sign-in email.
4. Enter their name.
5. Land on the invited match video.

An existing coach whose profile already has a display name skips the name step
and lands directly on the invited match. An all-matches invite lands on the
dashboard because it has no single video destination.

## Existing Behavior to Preserve

- Coaching invites are represented by `/coach-invite/<token>`.
- A logged-out invite visitor is sent to `/login` with the invite path in
  `next`.
- Both Google and email authentication support a post-authentication `next`
  destination.
- Middleware also stores the invite token in the HTTP-only
  `pending_coach_invite` cookie for one hour. This protects the journey when an
  authentication provider falls back to the configured Site URL and loses the
  original `next` value.
- `accept_coach_invite` is idempotent and returns the accepted coach-link row
  ID.
- Users without a display name are routed through `/onboarding`, which
  preserves their protected destination in its own `next` parameter.

## Recommended Design

Keep the existing two independent carriers for invite state:

- The encoded `next=/coach-invite/<token>` destination is the primary carrier.
- The secure `pending_coach_invite` cookie is the fallback carrier.

When either Google OAuth or email-link verification finishes and the fallback
cookie is present, the shared sign-in completion function will:

1. Validate the invite token format.
2. Call `accept_coach_invite`.
3. Read the exact coach-link row returned by that RPC, using its row ID.
4. Resolve the destination to `/match/<scope_match_id>` for a match-scoped
   invite or `/dashboard` for an all-matches invite.
5. Clear the fallback cookie.
6. Redirect to the resolved destination.

Using the returned row ID is important for reusable invitations. If another
coach already accepted the original invite-token row, Supabase creates a
coach-specific accepted row with a new token. Re-querying the original token
can therefore fail row-level security for the new coach, while querying the
returned row ID reliably finds the row the coach just accepted.

If the fallback cookie is absent, the encoded `next` value returns the coach to
the invite page. Its existing idempotent acceptance flow remains the fallback
and sends the coach to the same final destination.

## Name Onboarding Handoff

The shared sign-in completion code does not need to know whether the coach has
a name. It redirects to the protected destination:

- `/match/<id>` for a match-scoped invite
- `/dashboard` for an all-matches invite

The existing middleware then applies the global name requirement:

- Missing name: redirect to `/onboarding?next=<protected destination>`.
- Existing name: continue directly to the protected destination.

After the coach saves their name, onboarding replaces the route with the
preserved destination. This produces the required first-time sequence without
adding invitation-specific state or behavior to the onboarding UI.

## Failure Behavior

- Invalid, revoked, or otherwise unacceptable invites keep the existing invite
  error experience.
- If server-side fallback acceptance fails, sign-in still follows the safe
  encoded `next` destination instead of trapping the user.
- Unsafe or external `next` values continue to fall back to `/dashboard`.
- The fallback invite cookie is cleared after sign-in completion, including
  unsuccessful invite acceptance, so stale invitations cannot affect later
  sign-ins.
- Existing Google sign-in and ordinary email sign-in destinations remain
  unchanged.

## Testing

Automated regression coverage will verify:

- A successful match-scoped invite acceptance resolves to `/match/<id>` using
  the RPC-returned coach-link ID.
- A successful all-matches invite resolves to `/dashboard`.
- Failed acceptance preserves the safe requested destination.
- Invalid cookie tokens do not call invite acceptance.
- The protected match destination becomes the name-onboarding destination for
  a new user and remains direct for a named user.
- Existing authentication path and profile tests continue to pass.

Verification will also include lint, a production build, the existing frontend
test suites, and the worker test suite.

## Scope

This change modifies only authentication completion and regression coverage.
It does not change invitation creation, database schema or functions, email
templates, the name-onboarding UI, match authorization, or the coach viewing
experience.
