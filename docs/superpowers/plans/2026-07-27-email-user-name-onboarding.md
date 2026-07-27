# PongLens Email User Name Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require authenticated users without a Supabase metadata name to complete one clean name screen, while named Google users continue directly and every user can edit their name from Account.

**Architecture:** Put all name normalization, validation, metadata detection, and safe onboarding redirect construction in a pure auth-profile module. Enforce the missing-name gate in Supabase session middleware, render `/onboarding` with the same centered visual language as login, and persist `user_metadata.full_name` through the signed-in browser client. Reuse the same editor and validation contract on the Account page.

**Tech Stack:** Next.js 15 App Router, React 19 client components, Supabase Auth metadata, TypeScript Node test runner, Tailwind CSS.

## Global Constraints

- Onboarding heading is exactly **What should we call you?**
- Supporting copy is exactly **We’ll use this across PongLens.**
- Input label is exactly **Your name**.
- Primary action is exactly **Continue to PongLens**.
- Accept Unicode and punctuation; collapse repeated whitespace and trim both ends.
- Normalized names must contain 1–80 characters.
- Save the value only as `user_metadata.full_name`; do not add a database table or migration.
- Google users with `full_name` or `name` bypass onboarding.
- Reject external, protocol-relative, `/login`, `/auth/*`, and `/onboarding` post-onboarding destinations.
- Preserve the original protected pathname and query string through onboarding.
- Match the existing login card, logo, arena background, cyan CTA, spacing, and mobile behavior.
- No new package, environment variable, Supabase setting, or service-role operation.

---

### Task 1: Add tested auth-profile rules

**Files:**
- Create: `src/lib/auth/profile.ts`
- Create: `src/lib/auth/profile.test.ts`

**Interfaces:**
- Produces: `normalizeDisplayName(value: string): string`
- Produces: `displayNameFromMetadata(metadata: Record<string, unknown> | null | undefined): string | null`
- Produces: `displayNameError(value: string): string | null`
- Produces: `needsNameOnboarding(metadata: Record<string, unknown> | null | undefined): boolean`
- Produces: `safePostOnboardingPath(value: string | null | undefined): string`
- Produces: `buildOnboardingPath(next: string): string`
- Produces: `onboardingPathForProtectedRequest(metadata: Record<string, unknown> | null | undefined, next: string): string | null`

- [ ] **Step 1: Write failing profile tests**

Create `src/lib/auth/profile.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOnboardingPath,
  displayNameError,
  displayNameFromMetadata,
  needsNameOnboarding,
  normalizeDisplayName,
  onboardingPathForProtectedRequest,
  safePostOnboardingPath,
} from "./profile.ts";

test("reads a usable full name before provider name", () => {
  assert.equal(
    displayNameFromMetadata({ full_name: "Ada Lovelace", name: "Ada" }),
    "Ada Lovelace",
  );
});

test("treats missing and whitespace-only names as onboarding", () => {
  assert.equal(needsNameOnboarding({}), true);
  assert.equal(needsNameOnboarding({ full_name: "   " }), true);
  assert.equal(needsNameOnboarding({ name: "Grace Hopper" }), false);
});

test("normalizes repeated Unicode whitespace", () => {
  assert.equal(normalizeDisplayName("  María   José  "), "María José");
});

test("validates empty and overlong names", () => {
  assert.equal(displayNameError("   "), "Enter your name to continue.");
  assert.equal(
    displayNameError("a".repeat(81)),
    "Keep your name to 80 characters or fewer.",
  );
  assert.equal(displayNameError("Lin"), null);
});

test("keeps only safe non-recursive post-onboarding destinations", () => {
  assert.equal(safePostOnboardingPath("/match/123?point=4"), "/match/123?point=4");
  for (const unsafe of [
    "https://example.com",
    "//example.com",
    "/login",
    "/auth/callback",
    "/onboarding?next=/dashboard",
  ]) {
    assert.equal(safePostOnboardingPath(unsafe), "/dashboard");
  }
});

test("builds an encoded onboarding destination", () => {
  assert.equal(
    buildOnboardingPath("/match/123?point=4"),
    "/onboarding?next=%2Fmatch%2F123%3Fpoint%3D4",
  );
});

test("gates only missing-name users on protected destinations", () => {
  assert.equal(
    onboardingPathForProtectedRequest({}, "/account?section=sharing"),
    "/onboarding?next=%2Faccount%3Fsection%3Dsharing",
  );
  assert.equal(
    onboardingPathForProtectedRequest(
      { full_name: "Ada Lovelace" },
      "/dashboard",
    ),
    null,
  );
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
npm run test:auth
```

Expected: FAIL because `src/lib/auth/profile.ts` does not exist.

- [ ] **Step 3: Implement the profile rules**

Create `src/lib/auth/profile.ts` with:

```ts
const DEFAULT_DESTINATION = "/dashboard";
const MAX_DISPLAY_NAME_LENGTH = 80;

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function displayNameFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  for (const key of ["full_name", "name"] as const) {
    const value = metadata?.[key];
    if (typeof value === "string") {
      const normalized = normalizeDisplayName(value);
      if (normalized) return normalized;
    }
  }
  return null;
}

export function displayNameError(value: string): string | null {
  const normalized = normalizeDisplayName(value);
  if (!normalized) return "Enter your name to continue.";
  if (Array.from(normalized).length > MAX_DISPLAY_NAME_LENGTH) {
    return "Keep your name to 80 characters or fewer.";
  }
  return null;
}

export function needsNameOnboarding(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return displayNameFromMetadata(metadata) === null;
}

export function safePostOnboardingPath(
  value: string | null | undefined,
): string {
  if (!value?.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_DESTINATION;
  }
  const pathname = value.split(/[?#]/, 1)[0];
  if (
    pathname === "/login" ||
    pathname === "/onboarding" ||
    pathname.startsWith("/auth/")
  ) {
    return DEFAULT_DESTINATION;
  }
  return value;
}

export function buildOnboardingPath(next: string): string {
  return `/onboarding?next=${encodeURIComponent(
    safePostOnboardingPath(next),
  )}`;
}

export function onboardingPathForProtectedRequest(
  metadata: Record<string, unknown> | null | undefined,
  next: string,
): string | null {
  return needsNameOnboarding(metadata) ? buildOnboardingPath(next) : null;
}
```

- [ ] **Step 4: Run the auth tests and verify GREEN**

Run:

```bash
npm run test:auth
```

Expected: all auth tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/profile.ts src/lib/auth/profile.test.ts
git commit -m "feat: define name onboarding rules"
```

### Task 2: Enforce name onboarding in session middleware

**Files:**
- Modify: `src/lib/supabase/middleware.ts`
- Test: `src/lib/auth/profile.test.ts`

**Interfaces:**
- Consumes: `onboardingPathForProtectedRequest(user.user_metadata, originalDestination)` and `safePostOnboardingPath(next)` from Task 1.
- Produces: Required onboarding for authenticated missing-name users on protected routes while preserving path and query.

- [ ] **Step 1: Extend the redirect tests**

Add a test to `src/lib/auth/profile.test.ts` that verifies an Account query is preserved:

```ts
test("preserves a protected route query through onboarding", () => {
  assert.equal(
    buildOnboardingPath("/account?section=sharing"),
    "/onboarding?next=%2Faccount%3Fsection%3Dsharing",
  );
});
```

- [ ] **Step 2: Run the auth tests**

Run:

```bash
npm run test:auth
```

Expected: PASS because Task 1 already implements the pure redirect contract.

- [ ] **Step 3: Add middleware enforcement**

Update `src/lib/supabase/middleware.ts`:

```ts
import {
  buildOnboardingPath,
  onboardingPathForProtectedRequest,
  safePostOnboardingPath,
} from "@/lib/auth/profile";
```

Add `/onboarding` to the authenticated route set. After the unauthenticated
guard and before the existing `/login` redirect:

```ts
const protectedRoute = protectedPrefixes.some((prefix) =>
  path.startsWith(prefix),
);
const onboardingPath =
  user && protectedRoute && path !== "/onboarding"
    ? onboardingPathForProtectedRequest(
        user.user_metadata,
        `${path}${request.nextUrl.search}`,
      )
    : null;

if (onboardingPath) {
  return NextResponse.redirect(new URL(onboardingPath, request.url));
}
```

When an authenticated missing-name user opens `/login`, route them through
the same helper while keeping the existing named-user behavior:

```ts
const safeNext = safePostOnboardingPath(next);
const destination =
  onboardingPathForProtectedRequest(user.user_metadata, safeNext) ?? safeNext;
return NextResponse.redirect(new URL(destination, request.url));
```

- [ ] **Step 4: Run auth tests and lint**

Run:

```bash
npm run test:auth
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/profile.test.ts src/lib/supabase/middleware.ts
git commit -m "feat: require a name before protected routes"
```

### Task 3: Build the themed onboarding screen

**Files:**
- Create: `src/app/onboarding/page.tsx`
- Create: `src/app/onboarding/NameOnboardingForm.tsx`

**Interfaces:**
- Consumes: `displayNameFromMetadata`, `normalizeDisplayName`, `displayNameError`, and `safePostOnboardingPath`.
- Produces: A required signed-in name form that persists `user_metadata.full_name` and returns to the safe destination.

- [ ] **Step 1: Create the server page**

Create `src/app/onboarding/page.tsx` as a server component. It must:

```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect(`/login?next=${encodeURIComponent("/onboarding")}`);
const next = safePostOnboardingPath((await searchParams).next);
if (displayNameFromMetadata(user.user_metadata)) redirect(next);
```

Render `bg-arena`, a centered `max-w-sm` container, `<Logo />`, and the same
rounded `border-edge bg-surface p-8` card as `/login`.

- [ ] **Step 2: Create the client form**

Create `src/app/onboarding/NameOnboardingForm.tsx`. On submit:

```ts
const validationError = displayNameError(name);
if (validationError) {
  setError(validationError);
  return;
}
const fullName = normalizeDisplayName(name);
const { error } = await createClient().auth.updateUser({
  data: { full_name: fullName },
});
if (error) {
  setError("We couldn’t save your name. Try again.");
  return;
}
router.replace(next);
router.refresh();
```

Use `autoFocus`, `autoComplete="name"`, `maxLength={120}` to leave room for
pre-normalization whitespace, an accessible `role="alert"` error, and a
disabled **Saving…** button state.

- [ ] **Step 3: Run lint and production build**

Run:

```bash
npm run lint
set -a
source /Users/adil/Desktop/Projects/PongLens/.env.local
set +a
npm run build
```

Expected: both commands exit 0 and `/onboarding` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding/page.tsx src/app/onboarding/NameOnboardingForm.tsx
git commit -m "feat: add name onboarding screen"
```

### Task 4: Add a minimal Account name editor

**Files:**
- Create: `src/app/account/DisplayNameEditor.tsx`
- Modify: `src/app/account/page.tsx`

**Interfaces:**
- Consumes: the same normalization and validation functions from Task 1.
- Produces: An inline Account identity-card editor that updates `full_name`, refreshes server-rendered identity, and remains collapsed until **Edit** is selected.

- [ ] **Step 1: Create the Account editor**

Create `src/app/account/DisplayNameEditor.tsx` with props:

```ts
type DisplayNameEditorProps = {
  initialName: string;
};
```

The default view renders the name and an **Edit** button. Edit mode renders the
same **Your name** field with **Save** and **Cancel** controls. The save path
uses:

```ts
await supabase.auth.updateUser({
  data: { full_name: normalizeDisplayName(name) },
});
```

After success, close edit mode and call `router.refresh()`. Use the same three
validation/error strings as onboarding.

- [ ] **Step 2: Place it in the Account identity card**

In `src/app/account/page.tsx`, replace the static name paragraph with:

```tsx
<DisplayNameEditor initialName={name} />
```

Keep the email on the next line, the existing avatar, sign-out button, spacing,
and responsive behavior.

- [ ] **Step 3: Run auth tests, lint, and build**

Run:

```bash
npm run test:auth
npm run lint
set -a
source /Users/adil/Desktop/Projects/PongLens/.env.local
set +a
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/account/DisplayNameEditor.tsx src/app/account/page.tsx
git commit -m "feat: let users edit their display name"
```

### Task 5: Visual and full-repository verification

**Files:**
- Review: `src/app/onboarding/page.tsx`
- Review: `src/app/onboarding/NameOnboardingForm.tsx`
- Review: `src/app/account/DisplayNameEditor.tsx`
- Review: `src/lib/supabase/middleware.ts`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: Verified mobile/desktop behavior ready to merge and push.

- [ ] **Step 1: Render onboarding**

Run the app with the main checkout’s `.env.local`, open `/onboarding` using a
missing-name test session, and inspect at 1440×900 and 390×844. Confirm no
horizontal overflow, the keyboard-ready input is visible, and the CTA remains
above the fold.

- [ ] **Step 2: Verify named-user bypass and Account editing**

With `full_name` populated, verify `/onboarding` redirects to the safe `next`
route. On `/account`, select **Edit**, change the name, save, and confirm the
identity card and dashboard greeting update after refresh.

- [ ] **Step 3: Run the full verification suite**

Run:

```bash
npm run test:auth
npm run test:placement
npm run lint
set -a
source /Users/adil/Desktop/Projects/PongLens/.env.local
set +a
npm run build
PYTHONPATH=/Users/adil/Desktop/Projects/PongLens/worker/venv/lib/python3.12/site-packages \
  /Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest discover -s worker/tests -p 'test_*.py'
git diff --check
git status --short
```

Expected: all tests, lint, build, and diff checks pass; the worktree is clean.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch`, merge into `main`, rerun the
full verification suite on the merged result, and push `main` to `origin` as
explicitly requested by the user.
