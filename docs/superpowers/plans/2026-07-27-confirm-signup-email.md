# PongLens Confirm Signup Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a branded Supabase Confirm signup template that confirms a new email address and completes the existing PongLens passwordless sign-in flow in one click.

**Architecture:** Keep `signInWithOtp()` automatic account creation and the existing `/auth/confirm` verification route unchanged. Add a second repository-owned Supabase email template that uses the same `.RedirectTo` plus `.TokenHash` link contract as the existing Magic link template, then document the exact dashboard fields and smoke tests.

**Tech Stack:** Supabase Auth Go templates, table-based HTML email, Next.js 15 authentication route, Resend SMTP.

## Global Constraints

- Supabase dashboard template name is exactly **Confirm signup**.
- Subject is exactly **Confirm your email for PongLens**.
- The CTA is exactly **Confirm and continue**.
- The CTA URL is exactly `{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email`.
- Reuse `https://www.ponglens.com/img/email-logo.png`; do not embed a secret or attachment.
- Do not add a Resend key, Supabase key, Vercel variable, package, or application route.
- Preserve the existing **Magic link or OTP** template and its subject **Your PongLens sign-in link**.

---

### Task 1: Add the branded Confirm signup template

**Files:**
- Create: `supabase/email-templates/confirm-signup.html`
- Reference: `supabase/email-templates/magic-link.html`

**Interfaces:**
- Consumes: `{{ .RedirectTo }}` supplied by `EmailSignInForm`, `{{ .TokenHash }}` supplied by Supabase Auth, and the existing `GET /auth/confirm` route.
- Produces: A complete HTML fragment that can be pasted into the Supabase **Confirm signup** Body source field.

- [ ] **Step 1: Verify the template does not exist**

Run:

```bash
test ! -f supabase/email-templates/confirm-signup.html
```

Expected: exit code 0.

- [ ] **Step 2: Create the email template**

Create `supabase/email-templates/confirm-signup.html` with this complete source:

```html
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Confirm your email and continue to PongLens.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:48px 16px;background-color:#f4f5f7;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
        <tr>
          <td align="center" style="padding:40px 32px 36px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="https://www.ponglens.com/img/email-logo.png" width="180" height="44" alt="PongLens" style="display:block;width:180px;height:44px;border:0;margin:0 auto 28px;">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">Welcome to PongLens</h1>
            <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#475569;">Confirm your email to finish signing in. This secure link expires in one hour and can only be used once.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
              <tr>
                <td align="center" style="background-color:#0891b2;border-radius:999px;">
                  <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email" style="display:inline-block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">Confirm and continue</a>
                </td>
              </tr>
            </table>
            <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#64748b;">If you didn&#39;t request this email, you can safely ignore it.</p>
            <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Sent by PongLens &middot; ponglens.com</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

- [ ] **Step 3: Verify the required template contract**

Run:

```bash
node -e 'const fs=require("fs");const p="supabase/email-templates/confirm-signup.html";const s=fs.readFileSync(p,"utf8");for(const x of ["Welcome to PongLens","Confirm and continue","{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email","https://www.ponglens.com/img/email-logo.png"])if(!s.includes(x))throw new Error("Missing "+x);console.log("confirm-signup template contract OK")'
```

Expected: `confirm-signup template contract OK`.

- [ ] **Step 4: Render the template**

Serve `supabase/email-templates` locally and inspect
`http://localhost:3011/confirm-signup.html` at desktop and 390-pixel mobile
widths. Confirm the logo loads, the card remains within the viewport, the CTA
is legible, and no template variables appear as visible body text.

- [ ] **Step 5: Commit**

```bash
git add supabase/email-templates/confirm-signup.html
git commit -m "feat: add confirm signup email"
```

### Task 2: Document exact Supabase setup and verify the repository

**Files:**
- Modify: `supabase/README-SETUP.md`
- Test: `src/lib/auth/paths.test.ts`

**Interfaces:**
- Consumes: `supabase/email-templates/confirm-signup.html` from Task 1.
- Produces: Operator instructions for both Supabase passwordless email templates and the production/local confirmation URL allowlist.

- [ ] **Step 1: Update the passwordless email setup**

In `supabase/README-SETUP.md`, make **Authentication → Emails → Confirm signup**
an explicit step before **Magic link or OTP**. Specify:

```text
Confirm signup
Subject: Confirm your email for PongLens
Body: supabase/email-templates/confirm-signup.html

Magic link or OTP
Subject: Your PongLens sign-in link
Body: supabase/email-templates/magic-link.html
```

Add the expected behavior:

```text
A new email address receives Confirm signup; an existing address receives
Magic link or OTP. Each request sends one email, and either template must route
through /auth/confirm.
```

- [ ] **Step 2: Verify setup documentation contains every exact field**

Run:

```bash
rg -n "Confirm signup|Confirm your email for PongLens|confirm-signup.html|Magic link or OTP|Your PongLens sign-in link|magic-link.html|https://ponglens.com/auth/confirm|http://localhost:3000/auth/confirm" supabase/README-SETUP.md
```

Expected: every listed value appears.

- [ ] **Step 3: Run authentication tests**

Run:

```bash
npm run test:auth
```

Expected: 4 tests pass.

- [ ] **Step 4: Run lint and production build**

Run:

```bash
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/README-SETUP.md
git commit -m "docs: document confirm signup email"
```

### Task 3: Dashboard handoff and real-world smoke test

**Files:**
- Read: `supabase/email-templates/confirm-signup.html`
- Read: `supabase/README-SETUP.md`

**Interfaces:**
- Consumes: The verified repository template and operator instructions.
- Produces: Exact paste-ready Subject and Body plus a numbered Supabase dashboard checklist for the user.

- [ ] **Step 1: Provide the exact dashboard path**

Tell the operator to open:

```text
Supabase Dashboard → PongLens project → Authentication → Emails → Confirm signup
```

- [ ] **Step 2: Provide paste-ready values**

Provide:

```text
Subject: Confirm your email for PongLens
Body: the complete contents of supabase/email-templates/confirm-signup.html
```

Do not shorten, reformat, or substitute the `.RedirectTo` or `.TokenHash`
variables.

- [ ] **Step 3: Verify the URL allowlist**

Tell the operator to open:

```text
Authentication → URL Configuration
```

Confirm these entries exist under Redirect URLs:

```text
https://ponglens.com/auth/confirm
http://localhost:3000/auth/confirm
```

- [ ] **Step 4: Run a new-user smoke test**

Use a brand-new email address, submit it once on the PongLens login page, open
only the newest **Confirm your email for PongLens** message, and click
**Confirm and continue**. Expected: one email and an authenticated redirect to
PongLens.

- [ ] **Step 5: Run a returning-user smoke test**

Sign out, submit the same email once, open only the newest
**Your PongLens sign-in link** message, and click **Sign in to PongLens**.
Expected: one email and an authenticated redirect to PongLens.

