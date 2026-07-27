# Coach Invite Email Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that an invited first-time email coach signs in, enters their name, and lands on the shared match video without losing the coaching invite.

**Architecture:** Keep the encoded `next` destination and the HTTP-only pending-invite cookie as independent state carriers. Extract the cookie-based invite resolution into a testable auth helper, resolve reusable invites through the coach-link ID returned by `accept_coach_invite`, and leave the existing middleware name gate responsible for preserving the match destination through onboarding.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase Auth/Postgres RPC, Node test runner, ESLint

## Global Constraints

- Match-scoped invites end at `/match/<scope_match_id>`.
- All-matches invites end at `/dashboard`.
- First-time coaches without a display name complete `/onboarding` before the protected destination opens.
- Existing named coaches continue directly to the protected destination.
- Invalid or failed invite acceptance preserves the safe requested destination.
- No database schema, Supabase function, email-template, or UI changes.
- No new dependencies.

---

## File Structure

- Create `src/lib/auth/coachInvite.ts`: validate pending invite tokens and resolve accepted coach-link rows into safe application destinations through injected dependencies.
- Create `src/lib/auth/coachInvite.test.ts`: cover match-scoped, all-matches, failed, missing-row, and invalid-token resolution.
- Modify `src/lib/auth/completeSignIn.ts`: adapt the Supabase server client to the tested invite resolver and query the RPC-returned coach-link ID.
- Modify `src/lib/auth/profile.test.ts`: explicitly lock the first-time coach match destination through name onboarding.

### Task 1: Define and Implement Invite Destination Resolution

**Files:**
- Create: `src/lib/auth/coachInvite.test.ts`
- Create: `src/lib/auth/coachInvite.ts`

**Interfaces:**
- Consumes: a pending invite token, a safe fallback destination, and two injected asynchronous functions.
- Produces:
  - `type CoachInviteScope = { scope_match_id: string | null }`
  - `type CoachInviteCompletionDependencies = { acceptInvite(token: string): Promise<string | null>; findAcceptedLink(linkId: string): Promise<CoachInviteScope | null> }`
  - `resolvePendingCoachInviteDestination(pendingInvite, fallbackDestination, dependencies): Promise<string>`

- [ ] **Step 1: Write the failing destination tests**

Create `src/lib/auth/coachInvite.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePendingCoachInviteDestination,
  type CoachInviteCompletionDependencies,
} from "./coachInvite.ts";

const INVITE_TOKEN = "11111111-1111-4111-8111-111111111111";
const LINK_ID = "22222222-2222-4222-8222-222222222222";
const MATCH_ID = "33333333-3333-4333-8333-333333333333";

function dependencies(
  overrides: Partial<CoachInviteCompletionDependencies> = {},
): CoachInviteCompletionDependencies {
  return {
    acceptInvite: async () => LINK_ID,
    findAcceptedLink: async () => ({ scope_match_id: MATCH_ID }),
    ...overrides,
  };
}

test("resolves a match invite through the accepted link id", async () => {
  let requestedLinkId: string | null = null;
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    `/coach-invite/${INVITE_TOKEN}`,
    dependencies({
      findAcceptedLink: async (linkId) => {
        requestedLinkId = linkId;
        return { scope_match_id: MATCH_ID };
      },
    }),
  );

  assert.equal(requestedLinkId, LINK_ID);
  assert.equal(destination, `/match/${MATCH_ID}`);
});

test("sends an all-matches invite to the dashboard", async () => {
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    `/coach-invite/${INVITE_TOKEN}`,
    dependencies({
      findAcceptedLink: async () => ({ scope_match_id: null }),
    }),
  );

  assert.equal(destination, "/dashboard");
});

test("preserves the requested destination when acceptance fails", async () => {
  let queried = false;
  const fallback = `/coach-invite/${INVITE_TOKEN}`;
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    fallback,
    dependencies({
      acceptInvite: async () => null,
      findAcceptedLink: async () => {
        queried = true;
        return { scope_match_id: MATCH_ID };
      },
    }),
  );

  assert.equal(queried, false);
  assert.equal(destination, fallback);
});

test("preserves the requested destination when the accepted link is unavailable", async () => {
  const fallback = `/coach-invite/${INVITE_TOKEN}`;
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    fallback,
    dependencies({ findAcceptedLink: async () => null }),
  );

  assert.equal(destination, fallback);
});

test("ignores an invalid pending invite token", async () => {
  let accepted = false;
  const destination = await resolvePendingCoachInviteDestination(
    "not-a-token",
    "/dashboard",
    dependencies({
      acceptInvite: async () => {
        accepted = true;
        return LINK_ID;
      },
    }),
  );

  assert.equal(accepted, false);
  assert.equal(destination, "/dashboard");
});
```

- [ ] **Step 2: Run the auth tests and verify the RED state**

Run:

```bash
npm run test:auth
```

Expected: FAIL because `src/lib/auth/coachInvite.ts` does not exist.

- [ ] **Step 3: Implement the minimal invite resolver**

Create `src/lib/auth/coachInvite.ts`:

```ts
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CoachInviteScope = {
  scope_match_id: string | null;
};

export type CoachInviteCompletionDependencies = {
  acceptInvite(token: string): Promise<string | null>;
  findAcceptedLink(linkId: string): Promise<CoachInviteScope | null>;
};

export async function resolvePendingCoachInviteDestination(
  pendingInvite: string | null | undefined,
  fallbackDestination: string,
  dependencies: CoachInviteCompletionDependencies,
): Promise<string> {
  if (!pendingInvite || !UUID_RE.test(pendingInvite)) {
    return fallbackDestination;
  }

  const linkId = await dependencies.acceptInvite(pendingInvite);
  if (!linkId) {
    return fallbackDestination;
  }

  const link = await dependencies.findAcceptedLink(linkId);
  if (!link) {
    return fallbackDestination;
  }

  return link.scope_match_id
    ? `/match/${link.scope_match_id}`
    : "/dashboard";
}
```

- [ ] **Step 4: Run the auth tests and verify the GREEN state**

Run:

```bash
npm run test:auth
```

Expected: all existing auth tests and the five new invite tests pass.

- [ ] **Step 5: Commit the tested resolver**

```bash
git add src/lib/auth/coachInvite.ts src/lib/auth/coachInvite.test.ts
git commit -m "test: define coach invite auth destinations"
```

### Task 2: Wire Sign-In Completion to the Accepted Coach-Link ID

**Files:**
- Modify: `src/lib/auth/completeSignIn.ts:1-47`
- Modify: `src/lib/auth/profile.test.ts:63-82`

**Interfaces:**
- Consumes: `resolvePendingCoachInviteDestination()` from Task 1 and the existing Supabase server client.
- Produces: both Google and email confirmation routes continue receiving a `NextResponse` from `completeSignIn()`, now with a destination resolved from the exact accepted coach-link row.

- [ ] **Step 1: Add the explicit first-time coach onboarding regression**

Append to `src/lib/auth/profile.test.ts`:

```ts
test("preserves an invited match through first-time coach onboarding", () => {
  const matchDestination =
    "/match/33333333-3333-4333-8333-333333333333";

  assert.equal(
    onboardingPathForProtectedRequest({}, matchDestination),
    "/onboarding?next=%2Fmatch%2F33333333-3333-4333-8333-333333333333",
  );
  assert.equal(
    onboardingPathForProtectedRequest(
      { full_name: "Coach Carter" },
      matchDestination,
    ),
    null,
  );
});
```

- [ ] **Step 2: Run the targeted auth suite as a characterization check**

Run:

```bash
npm run test:auth
```

Expected: PASS. This records the already-approved name-gate behavior before the sign-in adapter changes.

- [ ] **Step 3: Replace token re-querying with the tested resolver**

In `src/lib/auth/completeSignIn.ts`:

1. Import `resolvePendingCoachInviteDestination` from `./coachInvite`.
2. Remove the local UUID regular expression.
3. Replace the invite block with:

```ts
  const fallbackDestination = safeNextPath(next);
  const destination = await resolvePendingCoachInviteDestination(
    pendingInvite,
    fallbackDestination,
    {
      acceptInvite: async (token) => {
        const { data, error } = await supabase.rpc("accept_coach_invite", {
          token,
        });
        return !error && typeof data === "string" ? data : null;
      },
      findAcceptedLink: async (linkId) => {
        const { data, error } = await supabase
          .from("coach_links")
          .select("scope_match_id")
          .eq("id", linkId)
          .maybeSingle();
        return error ? null : data;
      },
    },
  );
```

Keep forwarded-host handling, response creation, and pending-cookie deletion unchanged.

- [ ] **Step 4: Run auth tests, lint, and the production build**

Run:

```bash
npm run test:auth
npm run lint
npm run build
```

Expected: all auth tests pass, lint exits zero, and the Next.js production build completes with `/auth/callback`, `/auth/confirm`, `/coach-invite/[token]`, `/match/[id]`, and `/onboarding` in the route output.

- [ ] **Step 5: Commit the sign-in handoff**

```bash
git add src/lib/auth/completeSignIn.ts src/lib/auth/profile.test.ts
git commit -m "fix: preserve coach invite through email onboarding"
```

### Task 3: Full Regression Verification and Delivery

**Files:**
- Verify only; no production files are added in this task.

**Interfaces:**
- Consumes: the completed invite resolver and sign-in adapter.
- Produces: a verified main branch pushed to `origin/main`.

- [ ] **Step 1: Run every frontend unit suite**

```bash
npm run test:auth
npm run test:placement
npm run test:research
```

Expected: every test passes.

- [ ] **Step 2: Run static and production checks**

```bash
npm run lint
npm run build
git diff --check
```

Expected: lint and build exit zero, and `git diff --check` prints no errors.

- [ ] **Step 3: Run the worker regression suite**

```bash
PYTHONPATH=/Users/adil/Desktop/Projects/PongLens/worker/venv/lib/python3.12/site-packages \
  /Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest discover -s worker/tests -p 'test_*.py'
```

Expected: all worker tests pass.

- [ ] **Step 4: Review the final branch**

```bash
git status --short --branch
git log --oneline --decorate -5
git diff origin/main...HEAD --stat
```

Expected: only the approved design, plan, invite resolver/tests, sign-in adapter, and onboarding regression are ahead of `origin/main`.

- [ ] **Step 5: Push the verified result**

```bash
git push origin main
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

Expected: push succeeds and local `HEAD` equals `origin/main`.
