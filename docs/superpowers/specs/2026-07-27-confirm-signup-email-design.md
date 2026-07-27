# PongLens Confirm Signup Email Design

## Goal

Make the first passwordless email request behave like one complete sign-in:
a new user receives one branded email, clicks once, confirms the address, and
arrives in PongLens with an authenticated session.

## Current behavior

`supabase.auth.signInWithOtp()` creates a user by default when the submitted
email address is new. Supabase therefore selects one of two dashboard
templates:

- A new address receives **Confirm signup**.
- An existing address receives **Magic link or OTP**.

Only the Magic link or OTP template currently uses PongLens's custom
`/auth/confirm` token-hash flow. The default Confirm signup template can leave
the first-time user back at the login page, prompting a second request.

## Approved approach

Keep automatic account creation and customize both Supabase templates. The
login page remains a single **Continue with email** experience; users do not
need to understand whether Supabase is confirming a new account or signing in
an existing one.

No authentication route or login-page behavior needs to change. The existing
`emailRedirectTo` value and `/auth/confirm` route already support verifying an
email token and completing the shared post-sign-in flow.

## Confirm signup template

Create `supabase/email-templates/confirm-signup.html` using the same light
PongLens email card, hosted logo, cyan call-to-action, typography, spacing,
security note, and footer as the Magic link template.

Use these exact dashboard values:

- Supabase template: **Authentication → Emails → Confirm signup**
- Subject: **Confirm your email for PongLens**
- Preheader: **Confirm your email and continue to PongLens.**
- Heading: **Welcome to PongLens**
- Body: **Confirm your email to finish signing in. This secure link expires in
  one hour and can only be used once.**
- Button: **Confirm and continue**
- Security note: **If you didn't request this email, you can safely ignore it.**

The button URL must be:

```html
{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email
```

`{{ .RedirectTo }}` is the PongLens `/auth/confirm?next=...` URL passed by the
login form. `{{ .TokenHash }}` is verified by the existing confirmation route.
The `type=email` value matches the route's accepted email OTP type.

## Operator setup

Update `supabase/README-SETUP.md` so setup is explicit and reproducible:

1. Open the PongLens project in Supabase.
2. Go to **Authentication → Emails**.
3. Open **Confirm signup**.
4. Replace the Subject with **Confirm your email for PongLens**.
5. Replace the complete Body source with
   `supabase/email-templates/confirm-signup.html`.
6. Save the template.
7. Confirm **Magic link or OTP** still uses subject
   **Your PongLens sign-in link** and
   `supabase/email-templates/magic-link.html`.
8. Confirm the URL allowlist contains
   `https://ponglens.com/auth/confirm` and
   `http://localhost:3000/auth/confirm`.
9. Test once with a brand-new address and once with an existing address.

No new Resend key, Supabase key, Vercel environment variable, or provider
setting is required.

## Expected behavior

- New email address: one **Confirm your email for PongLens** email; its button
  confirms the address, establishes the session, and sends the user to the
  requested safe PongLens destination.
- Existing email address: one **Your PongLens sign-in link** email; its button
  establishes the session and sends the user to the requested safe destination.
- Requesting a newer link may make an earlier one unusable, and every link is
  single-use. The user should open only the latest email.
- Invalid, consumed, or expired links return to the login page with the
  existing safe error message.

## Verification

- Render the new template at desktop and narrow mobile widths.
- Confirm the hosted light-mode logo loads.
- Confirm the button URL contains `.RedirectTo`, `.TokenHash`, and
  `type=email` exactly once.
- Run the existing authentication tests, lint, and production build.
- Perform a real new-address smoke test after the dashboard template is
  pasted, because Supabase dashboard configuration is external to the repo.

