# PongLens Email Sign-In and Auth Email Design

**Date:** 2026-07-27

**Status:** Approved direction

## Goal

Add passwordless email sign-in alongside Google without exposing the term
"Magic Link" in the interface. Give authentication and match-ready emails a
consistent, warm PongLens voice that represents the full match-review product.

## Product decisions

- Keep Google as the first and fastest sign-in option.
- Present the second option as **Continue with email**.
- Explain the behavior as "We'll email you a secure sign-in link. No password
  needed."
- Allow an unfamiliar email address to create a new PongLens user. This makes
  email a complete alternative to Google rather than an existing-user recovery
  mechanism.
- Preserve the requested destination and the existing automatic coach-invite
  acceptance behavior for both sign-in methods.
- Do not introduce passwords, email OTP entry, or account-type selection.

## Login experience

The existing login card keeps its width, dark visual system, logo, legal copy,
and back link.

The card content becomes:

1. Heading: **Sign in to PongLens**
2. Supporting copy: **Upload a match or pick up where you left off.**
3. Existing **Continue with Google** button
4. A horizontal divider labeled **or continue with email**
5. A visible **Email address** label and email input
6. A full-width **Continue with email** button
7. Helper copy: **We'll email you a secure sign-in link. No password needed.**
8. Existing Terms and Privacy acknowledgement

The email input uses `type="email"`, `inputMode="email"`,
`autoComplete="email"`, and a visible label. Submission disables the input and
button and changes the button label to **Sending…**.

After Supabase accepts the request, the form is replaced with:

- Heading: **Check your inbox**
- Copy: **We sent a sign-in link to {email}. Open it to finish signing in.**
- Action: **Use a different email**

The success response does not reveal whether an account already existed.
Failures appear in an `aria-live` region using the user-safe message:
**We couldn't send the email. Wait a minute and try again.**

## Authentication flow

The browser client calls:

```ts
supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo:
      `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
  },
})
```

`shouldCreateUser` is left at Supabase's documented default of `true`.

The Supabase Magic Link email template constructs a link from
`{{ .RedirectTo }}`, `{{ .TokenHash }}`, and `type=email`. A new
`/auth/confirm` route reads those values, validates `next` as a same-origin path,
calls `supabase.auth.verifyOtp`, and stores the resulting session in the
existing SSR cookies.

Google continues to use `/auth/callback` and
`exchangeCodeForSession`. Successful Google and email verification both call a
shared server-only completion helper that:

1. Sanitizes the destination.
2. Accepts a pending coach invite when the one-shot invite cookie is present.
3. Chooses the match or dashboard destination.
4. Honors the forwarded production host.
5. Clears the pending invite cookie.

Invalid, expired, or already-used links return to
`/login?error=email-link`. The login card shows:
**That sign-in link is invalid or has expired. Request a new one below.**

## Supabase email template

The repository stores the source of truth at
`supabase/email-templates/magic-link.html`. The dashboard subject is:

**Your PongLens sign-in link**

The template uses the established PongLens email system:

- `#f4f5f7` page background
- 480px white card with a subtle border and 16px radius
- `https://www.ponglens.com/img/email-logo.png` at 180×44
- dark navy heading, slate body copy
- cyan pill CTA
- restrained gray footer

Copy:

- Preheader: **Use this secure link to continue to PongLens.**
- Heading: **Continue to PongLens**
- Body: **Use the secure link below to sign in and get back to your matches.
  The link expires in one hour and can only be used once.**
- CTA: **Sign in to PongLens**
- Safety note: **If you didn't request this email, you can safely ignore it.**
- Footer: **Sent by PongLens · ponglens.com**

The template contains one authentication link to reduce ambiguity and preserve
deliverability.

## Existing transactional email updates

### Match ready

- Subject: **Your match is ready to review**
- Preheader: **Your match has finished processing and is ready in PongLens.**
- Heading: **Your match is ready**
- Body: **We finished processing {filename}. Open PongLens to review the match
  point by point, add notes, and share it with your coach.**
- CTA: **Review your match**

This replaces the narrow "What's left is pure play" and "Download your video"
language.

### Export ready

- Subject: **Your match export is ready**
- Preheader: **Your shareable match video is ready.**
- Heading: **Your export is ready**
- Body: **Your shareable match video has finished rendering. Open the match to
  save it or share it anywhere.**
- CTA: **Open your match**

## Documentation and policy text

- Update the README architecture note from "Google sign-in only" to Google and
  passwordless email through Supabase Auth.
- Extend the Supabase setup runbook with Email provider, SMTP, redirect URL,
  template subject, and paste instructions.
- Update Terms and Privacy wording that currently says users sign in through
  Google. Email sign-in collects the email address but no password.
- Keep Google-specific wording only when describing data returned by Google
  OAuth.

## Validation

- Unit-test same-origin destination sanitization, including rejection of
  protocol-relative and absolute URLs.
- Unit-test authentication error copy selection.
- Run ESLint and a production Next.js build.
- Run the existing placement tests to guard against unrelated regressions.
- Render the stored HTML email and visually inspect the light theme, button,
  wrapping, and mobile width.
- Browser-smoke-test Google sign-in initiation, email validation, loading,
  success, different-email reset, and expired-link error presentation.
- Before production use, paste the stored template into Supabase and allow-list:
  - `https://ponglens.com/auth/confirm`
  - `http://localhost:3000/auth/confirm`

## Non-goals

- Password authentication
- Six-digit OTP entry
- CAPTCHA in this first pass
- Profile-name onboarding for email-only users
- Changes to database tables or row-level security
