# Email Sign-In and Auth Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add passwordless email sign-in beside Google, complete email sessions through Supabase SSR, and align authentication, match-ready, and export-ready email copy.

**Architecture:** A focused client component initiates `signInWithOtp` and owns the email form state. Pure helpers sanitize destinations and build the confirmation URL; a server-only completion helper is shared by the existing Google callback and a new token-hash confirmation route so coach-invite handling remains identical. The Supabase template is stored in the repository as the source of truth and pasted into the hosted dashboard.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.110, Node built-in test runner, Python worker email templates.

## Global Constraints

- User-facing copy says **Continue with email**, not "Magic Link."
- Google remains the first sign-in option.
- Unfamiliar email addresses may create new Supabase users.
- Authentication destinations must remain same-origin paths.
- Google and email sign-in must share automatic coach-invite completion.
- No password UI, six-digit OTP UI, CAPTCHA, database migration, or RLS change.
- Preserve the unrelated working-tree changes in `src/app/match/[id]/Player.tsx`.

---

### Task 1: Authentication URL and error helpers

**Files:**
- Create: `src/lib/auth/paths.ts`
- Create: `src/lib/auth/paths.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `safeNextPath(value: string | null | undefined): string`
- Produces: `buildEmailConfirmRedirect(origin: string, next: string): string`
- Produces: `loginErrorMessage(code: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing helper tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmailConfirmRedirect,
  loginErrorMessage,
  safeNextPath,
} from "./paths.ts";

test("safeNextPath accepts a local application path", () => {
  assert.equal(safeNextPath("/match/123?tab=notes"), "/match/123?tab=notes");
});

test("safeNextPath rejects absolute and protocol-relative destinations", () => {
  assert.equal(safeNextPath("https://evil.example"), "/dashboard");
  assert.equal(safeNextPath("//evil.example"), "/dashboard");
  assert.equal(safeNextPath(undefined), "/dashboard");
});

test("buildEmailConfirmRedirect carries an encoded destination", () => {
  assert.equal(
    buildEmailConfirmRedirect("https://ponglens.com", "/match/123?tab=notes"),
    "https://ponglens.com/auth/confirm?next=%2Fmatch%2F123%3Ftab%3Dnotes",
  );
});

test("loginErrorMessage explains an expired email link", () => {
  assert.equal(
    loginErrorMessage("email-link"),
    "That sign-in link is invalid or has expired. Request a new one below.",
  );
  assert.equal(loginErrorMessage(undefined), null);
});
```

- [ ] **Step 2: Add and run the auth test script**

Add:

```json
"test:auth": "node --test --experimental-strip-types src/lib/auth/*.test.ts"
```

Run: `npm run test:auth`

Expected: FAIL because `src/lib/auth/paths.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

```ts
const DEFAULT_DESTINATION = "/dashboard";

export function safeNextPath(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : DEFAULT_DESTINATION;
}

export function buildEmailConfirmRedirect(
  origin: string,
  next: string,
): string {
  return `${origin}/auth/confirm?next=${encodeURIComponent(safeNextPath(next))}`;
}

export function loginErrorMessage(
  code: string | null | undefined,
): string | null {
  if (code === "email-link") {
    return "That sign-in link is invalid or has expired. Request a new one below.";
  }
  if (code === "auth") {
    return "We couldn't sign you in. Please try again.";
  }
  return null;
}
```

- [ ] **Step 4: Verify the helpers**

Run: `npm run test:auth`

Expected: 4 tests pass.

- [ ] **Step 5: Commit the helper slice**

```bash
git add package.json src/lib/auth/paths.ts src/lib/auth/paths.test.ts
git commit -m "test: define email auth redirect behavior"
```

---

### Task 2: Shared sign-in completion and email confirmation route

**Files:**
- Create: `src/lib/auth/completeSignIn.ts`
- Create: `src/app/auth/confirm/route.ts`
- Modify: `src/app/auth/callback/route.ts`
- Modify: `src/lib/supabase/middleware.ts`

**Interfaces:**
- Consumes: `safeNextPath`
- Produces: `completeSignIn(request, next, supabase): Promise<NextResponse>`
- Google callback continues consuming `code`.
- Email confirmation consumes `token_hash`, `type=email`, and `next`.

- [ ] **Step 1: Extract the already-working post-authentication behavior**

Create the server-only helper with the existing pending-invite lookup,
`accept_coach_invite` call, forwarded-host selection, destination redirect,
and cookie deletion:

```ts
import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "./paths";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function completeSignIn(
  request: Request,
  next: string,
  supabase: SupabaseServerClient,
) {
  const cookieStore = await cookies();
  const pendingInvite = cookieStore.get("pending_coach_invite")?.value;
  let destination = safeNextPath(next);

  if (pendingInvite && UUID_RE.test(pendingInvite)) {
    await supabase.rpc("accept_coach_invite", { token: pendingInvite });
    const { data: link } = await supabase
      .from("coach_links")
      .select("scope_match_id, coach_id")
      .eq("invite_token", pendingInvite)
      .maybeSingle();
    if (link?.coach_id) {
      destination = link.scope_match_id
        ? `/match/${link.scope_match_id}`
        : "/dashboard";
    }
  }

  const { origin } = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    process.env.NODE_ENV !== "development" && forwardedHost
      ? `https://${forwardedHost}`
      : origin;
  const response = NextResponse.redirect(`${base}${destination}`);
  response.cookies.delete("pending_coach_invite");
  return response;
}
```

The extraction must preserve behavior exactly; it does not change database
queries or destination precedence.

- [ ] **Step 2: Rewire the Google callback**

Keep `exchangeCodeForSession(code)` in `src/app/auth/callback/route.ts`. On
success, call:

```ts
return completeSignIn(
  request,
  safeNextPath(searchParams.get("next")),
  supabase,
);
```

Retain `/login?error=auth` for failed Google exchanges.

- [ ] **Step 3: Add the token-hash confirmation route**

```ts
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { completeSignIn } from "@/lib/auth/completeSignIn";
import { safeNextPath } from "@/lib/auth/paths";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && type === "email") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return completeSignIn(request, next, supabase);
  }

  return NextResponse.redirect(`${origin}/login?error=email-link`);
}
```

- [ ] **Step 4: Generalize stale Google-only middleware comments**

Change comments that say a coach is leaving for Google sign-in to describe
either external or email authentication. Do not change the cookie behavior.

- [ ] **Step 5: Run focused and static verification**

Run:

```bash
npm run test:auth
npx eslint src/lib/auth src/app/auth src/lib/supabase/middleware.ts
```

Expected: all auth tests pass and ESLint exits 0.

- [ ] **Step 6: Commit the server flow**

```bash
git add src/lib/auth src/app/auth src/lib/supabase/middleware.ts
git commit -m "feat: complete passwordless email sessions"
```

---

### Task 3: Combined Google and email login interface

**Files:**
- Create: `src/app/login/EmailSignInForm.tsx`
- Modify: `src/app/login/GoogleSignInButton.tsx`
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `buildEmailConfirmRedirect`, `loginErrorMessage`
- `EmailSignInForm` accepts `{ next: string }`.
- The server page accepts `{ next?: string; error?: string }`.

- [ ] **Step 1: Build the email form component**

Create the client component with `email`, `loading`, `sentEmail`, and `error`
state:

```ts
"use client";

import { FormEvent, useState } from "react";
import { buildEmailConfirmRedirect } from "@/lib/auth/paths";
import { createClient } from "@/lib/supabase/client";

export function EmailSignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedEmail = email.trim();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: submittedEmail,
      options: {
        emailRedirectTo: buildEmailConfirmRedirect(
          window.location.origin,
          next,
        ),
      },
    });

    setLoading(false);
    if (signInError) {
      setError(
        "We couldn't send the email. Wait a minute and try again.",
      );
      return;
    }
    setSentEmail(submittedEmail);
  }

  if (sentEmail) {
    return (
      <div className="mt-6 text-center" aria-live="polite">
        <h2 className="text-base font-semibold">Check your inbox</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          We sent a sign-in link to{" "}
          <strong className="font-medium text-zinc-200">{sentEmail}</strong>.
          Open it to finish signing in.
        </p>
        <button
          type="button"
          onClick={() => setSentEmail(null)}
          className="mt-4 text-sm font-medium text-cyan-glow hover:text-cyan-300"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-edge" />
        <span className="text-xs text-zinc-500">or continue with email</span>
        <span className="h-px flex-1 bg-edge" />
      </div>
      <form onSubmit={submit}>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-zinc-200"
        >
          Email address
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          disabled={loading}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-white placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={loading}
          className="mt-3 w-full rounded-full bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Sending…" : "Continue with email"}
        </button>
        <p className="mt-3 text-center text-xs leading-relaxed text-zinc-500">
          We'll email you a secure sign-in link. No password needed.
        </p>
        {error && (
          <p
            role="alert"
            aria-live="polite"
            className="mt-3 text-center text-xs text-red-400"
          >
            {error}
          </p>
        )}
      </form>
    </>
  );
}
```

- [ ] **Step 2: Integrate the form into the login card**

Change the heading and supporting copy to:

```tsx
<h1>Sign in to PongLens</h1>
<p>Upload a match or pick up where you left off.</p>
```

Render Google first, then `EmailSignInForm`. Read `error` from search params,
map it through `loginErrorMessage`, and render the message with `role="alert"`.
Keep the existing Terms, Privacy, logo, and back link.

- [ ] **Step 3: Make the Google button explicitly non-submit**

Add `type="button"` without changing OAuth behavior or visual hierarchy.

- [ ] **Step 4: Verify the interface statically**

Run:

```bash
npm run test:auth
npx eslint src/app/login src/lib/auth
```

Expected: tests pass and ESLint exits 0.

- [ ] **Step 5: Commit the login interface**

```bash
git add src/app/login src/lib/auth
git commit -m "feat: add sign in with email"
```

---

### Task 4: Paste-ready Supabase template and transactional email copy

**Files:**
- Create: `supabase/email-templates/magic-link.html`
- Modify: `worker/worker.py`

**Interfaces:**
- Template consumes `{{ .RedirectTo }}` and `{{ .TokenHash }}`.
- Match-ready Python function continues consuming the escaped original name.
- Export-ready Python function continues consuming the match URL.

- [ ] **Step 1: Add the paste-ready magic-link HTML**

Create this complete table-based light-theme email. Its sole action URL uses
the redirect and token-hash variables:

```html
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Use this secure link to continue to PongLens.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:48px 16px;background-color:#f4f5f7;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
        <tr>
          <td align="center" style="padding:40px 32px 36px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="https://www.ponglens.com/img/email-logo.png" width="180" height="44" alt="PongLens" style="display:block;width:180px;height:44px;border:0;margin:0 auto 28px;">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">Continue to PongLens</h1>
            <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#475569;">Use the secure link below to sign in and get back to your matches. The link expires in one hour and can only be used once.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
              <tr>
                <td align="center" style="background-color:#0891b2;border-radius:999px;">
                  <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email" style="display:inline-block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">Sign in to PongLens</a>
                </td>
              </tr>
            </table>
            <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#64748b;">If you didn't request this email, you can safely ignore it.</p>
            <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Sent by PongLens &middot; ponglens.com</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

- [ ] **Step 2: Update match-ready copy**

Change:

```text
Subject: Your match is ready to review
Preheader: Your match has finished processing and is ready in PongLens.
Body: We finished processing {filename}. Open PongLens to review the match
point by point, add notes, and share it with your coach.
CTA: Review your match
```

- [ ] **Step 3: Update export-ready copy**

Change:

```text
Subject: Your match export is ready
Preheader: Your shareable match video is ready.
Body: Your shareable match video has finished rendering. Open the match to
save it or share it anywhere.
CTA: Open your match
```

- [ ] **Step 4: Check the exact template variables and copy**

Run:

```bash
rg -n "RedirectTo|TokenHash|Continue to PongLens|Sign in to PongLens" supabase/email-templates/magic-link.html
rg -n "pure play|Download your video|Your match is ready to review|Review your match|Your match export is ready|Open your match" worker/worker.py
```

Expected: both template variables appear; old narrow copy does not appear in
the affected emails; new subjects and CTAs appear.

- [ ] **Step 5: Commit the email slice**

```bash
git add supabase/email-templates/magic-link.html worker/worker.py
git commit -m "feat: refresh PongLens transactional emails"
```

---

### Task 5: Setup, README, and policy accuracy

**Files:**
- Modify: `README.md`
- Modify: `supabase/README-SETUP.md`
- Modify: `src/app/privacy/page.tsx`
- Modify: `src/app/terms/page.tsx`

**Interfaces:**
- Documentation names `supabase/email-templates/magic-link.html` as the
  dashboard source of truth.

- [ ] **Step 1: Update architecture and setup documentation**

Replace "Google sign-in only" with Google and passwordless email through
Supabase Auth. Add exact hosted setup values:

```text
Subject: Your PongLens sign-in link
Production redirect: https://ponglens.com/auth/confirm
Local redirect: http://localhost:3000/auth/confirm
Template body: supabase/email-templates/magic-link.html
```

State explicitly that the Resend SMTP API key is pasted into Supabase's SMTP
Password field and is not a Vercel environment variable.

- [ ] **Step 2: Update Privacy wording**

Describe email as always collected for account authentication. Explain that
Google sign-in additionally supplies name and profile picture, while
passwordless email sign-in uses the email address and does not collect a
password.

- [ ] **Step 3: Update Terms wording**

Replace the Google-only sign-in statement with Google or passwordless email via
Supabase Auth. Keep the existing third-party and early-access terms otherwise
unchanged.

- [ ] **Step 4: Verify stale wording is gone**

Run:

```bash
rg -n "Google sign-in only|sign in with a Google account|Google password" README.md supabase/README-SETUP.md src/app/privacy/page.tsx src/app/terms/page.tsx
```

Expected: no claim remains that Google is the only method; any Google password
reference is scoped to Google OAuth and email sign-in explicitly says no
password.

- [ ] **Step 5: Commit documentation and policy updates**

```bash
git add README.md supabase/README-SETUP.md src/app/privacy/page.tsx src/app/terms/page.tsx
git commit -m "docs: document email authentication"
```

---

### Task 6: Full verification and visual QA

**Files:**
- Verify all files changed in Tasks 1–5.

**Interfaces:**
- No new interfaces.

- [ ] **Step 1: Run the full automated checks**

```bash
npm run test:auth
npm run test:placement
npm run lint
npm run build
python3 -m unittest discover -s worker/tests -p 'test_*.py'
```

Expected: every command exits 0.

- [ ] **Step 2: Render and inspect the email template**

Replace the Supabase variables only in a temporary copy:

```text
RedirectTo → https://ponglens.com/auth/confirm?next=%2Fdashboard
TokenHash → preview-token
```

Open the temporary HTML in a browser and inspect at desktop and mobile widths.
Confirm the wordmark loads, copy wraps cleanly, the CTA is visible, and the
email has only one sign-in link.

- [ ] **Step 3: Browser-smoke-test the login page**

Run `npm run dev`, open `/login`, and confirm:

- Google is first.
- The divider reads "or continue with email."
- Invalid email is rejected by native form validation.
- A stubbed successful `/auth/v1/otp` response produces "Check your inbox."
- "Use a different email" restores the form.
- `/login?error=email-link` shows the expired-link message.

- [ ] **Step 4: Inspect the final diff and working tree**

```bash
git diff --check
git status --short
git log --oneline --decorate -8
```

Expected: no whitespace errors, no accidental change to
`src/app/match/[id]/Player.tsx`, and only the planned feature commits.

- [ ] **Step 5: Record the two remaining hosted-dashboard actions**

Tell the user to:

1. Paste subject **Your PongLens sign-in link** and the exact contents of
   `supabase/email-templates/magic-link.html` into Supabase.
2. Add the production and local `/auth/confirm` URLs to the Supabase redirect
   allow-list before testing.
