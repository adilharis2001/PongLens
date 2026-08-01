# Protected Research Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished `/research` dashboard that lists every research tool for authenticated admins and active research reviewers only, without advertising the route anywhere else.

**Architecture:** A typed static catalog and a small pure access-policy helper live beside the route. A server page performs Supabase authentication and allowlist checks, then passes the catalog to a presentation-only dashboard component. Node tests cover the catalog and access policy directly and use the repository's established source-contract pattern for route wiring, privacy metadata, rendered links, and absence from public navigation.

**Tech Stack:** Next.js 15 App Router, React 19 server components, TypeScript, Tailwind CSS 4, Supabase SSR, Node's built-in test runner.

## Global Constraints

- `/research` remains absent from the landing page, site header, site footer, app navigation, sitemap, and every other discovery surface.
- Access is granted only when the current user is an admin or has an active `research_reviewers` row.
- Every admitted reviewer sees all four current research destinations, regardless of batch assignment.
- Unauthorized signed-in users receive a 404; signed-out users return to `/research` after login.
- Metadata is `index: false`, `follow: false`, and `nocache: true`.
- No database migration and no new dependency.
- No assignment management, progress metrics, filtering, search, or activity feed.

---

## File Structure

- Create `src/app/research/researchDashboard.ts`: typed catalog and pure authorization policy.
- Create `src/app/research/researchDashboard.test.ts`: catalog, policy, route, view, and discoverability contracts.
- Create `src/app/research/ResearchDashboard.tsx`: presentation-only responsive dashboard.
- Create `src/app/research/page.tsx`: server authentication, authorization, metadata, and rendering.
- Modify `package.json`: include the new dashboard test in `test:research`.

### Task 1: Research Catalog and Access Policy

**Files:**
- Create: `src/app/research/researchDashboard.test.ts`
- Create: `src/app/research/researchDashboard.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ResearchPage`, an immutable dashboard-card record.
- Produces: `RESEARCH_PAGES`, a readonly array containing the four destinations.
- Produces: `hasResearchDashboardAccess(isAdmin: boolean, reviewerActive: boolean): boolean`.
- Consumes: no application runtime dependency.

- [ ] **Step 1: Write failing catalog and authorization tests**

Create `src/app/research/researchDashboard.test.ts` with the direct behavior tests below. The route/view contract tests shown in Task 2 will be appended later.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_PAGES,
  hasResearchDashboardAccess,
} from "./researchDashboard.ts";
import { isProtectedAppPath } from "../../lib/auth/paths.ts";

test("the research catalog contains every current research page", () => {
  assert.deepEqual(
    RESEARCH_PAGES.map(({ title, href }) => ({ title, href })),
    [
      { title: "Fused labeling", href: "/research/fused-labeling" },
      {
        title: "Placement calibration",
        href: "/research/placement-calibration",
      },
      { title: "Serve detection", href: "/research/serve-detection" },
      {
        title: "Point-ending research",
        href: "/research/winner-constrained-endings",
      },
    ],
  );
  assert.equal(new Set(RESEARCH_PAGES.map((page) => page.href)).size, 4);
  for (const page of RESEARCH_PAGES) {
    assert.ok(page.category.length > 0);
    assert.ok(page.description.length > 0);
  }
});

test("research access is limited to admins and active reviewers", () => {
  assert.equal(hasResearchDashboardAccess(true, false), true);
  assert.equal(hasResearchDashboardAccess(false, true), true);
  assert.equal(hasResearchDashboardAccess(false, false), false);
});

test("the central auth gate protects the research dashboard", () => {
  assert.equal(isProtectedAppPath("/research"), true);
});
```

- [ ] **Step 2: Add the test to the focused research command**

Change `package.json` so `test:research` runs both existing library tests and the dashboard test:

```json
"test:research": "node --test --experimental-strip-types src/lib/research/*.test.ts src/app/research/researchDashboard.test.ts"
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
npm run test:research
```

Expected: FAIL because `./researchDashboard.ts` does not exist.

- [ ] **Step 4: Implement the typed catalog and policy**

Create `src/app/research/researchDashboard.ts`:

```ts
export interface ResearchPage {
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly href: `/research/${string}`;
  readonly accent: "cyan" | "magenta";
}

export const RESEARCH_PAGES = [
  {
    title: "Fused labeling",
    category: "Data labeling",
    description:
      "Review synchronized audio and ball-tracking evidence to produce trusted point labels.",
    href: "/research/fused-labeling",
    accent: "cyan",
  },
  {
    title: "Placement calibration",
    category: "Model calibration",
    description:
      "Compare placement predictions and calibrate how landing locations map onto the table.",
    href: "/research/placement-calibration",
    accent: "magenta",
  },
  {
    title: "Serve detection",
    category: "Model evaluation",
    description:
      "Label serve timing and inspect the latest temporal serve-detection results.",
    href: "/research/serve-detection",
    accent: "cyan",
  },
  {
    title: "Point-ending research",
    category: "Model evaluation",
    description:
      "Review winner-constrained point endings and identify the final decisive contact.",
    href: "/research/winner-constrained-endings",
    accent: "magenta",
  },
] as const satisfies readonly ResearchPage[];

export function hasResearchDashboardAccess(
  isAdmin: boolean,
  reviewerActive: boolean,
): boolean {
  return isAdmin || reviewerActive;
}
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
npm run test:research
```

Expected: all existing research tests and the three new tests PASS.

- [ ] **Step 6: Commit the policy layer**

```bash
git add package.json src/app/research/researchDashboard.ts src/app/research/researchDashboard.test.ts
git commit -m "feat: define research dashboard catalog"
```

### Task 2: Protected Dashboard Route and Presentation

**Files:**
- Modify: `src/app/research/researchDashboard.test.ts`
- Create: `src/app/research/ResearchDashboard.tsx`
- Create: `src/app/research/page.tsx`

**Interfaces:**
- Consumes: `RESEARCH_PAGES` and `hasResearchDashboardAccess` from Task 1.
- Produces: `ResearchDashboard({ pages }: { pages: readonly ResearchPage[] })`, a presentation-only server component.
- Produces: the `/research` route with auth, allowlist, privacy metadata, and no navigation registration.

- [ ] **Step 1: Append failing route, view, and discoverability contract tests**

Add these imports and tests to `src/app/research/researchDashboard.test.ts`:

```ts
import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("the dashboard route is private and fail-closed", () => {
  const page = read("./page.tsx");
  assert.match(page, /auth\.getUser\(\)/);
  assert.match(page, /redirect\("\/login\?next=\/research"\)/);
  assert.match(page, /\.from\("research_reviewers"\)/);
  assert.match(page, /\.eq\("user_id", user\.id\)/);
  assert.match(page, /supabase\.rpc\("is_admin"\)/);
  assert.match(page, /!reviewerResult\.error/);
  assert.match(page, /hasResearchDashboardAccess/);
  assert.match(page, /notFound\(\)/);
  assert.match(
    page,
    /robots: \{ index: false, follow: false, nocache: true \}/,
  );
});

test("the dashboard renders every catalog item as a large destination link", () => {
  const view = read("./ResearchDashboard.tsx");
  assert.match(view, /<Logo href="\/dashboard"/);
  assert.match(view, /<h1[^>]*>[\s\S]*Research[\s\S]*<\/h1>/);
  assert.match(view, /pages\.map/);
  assert.match(view, /href=\{page\.href\}/);
  assert.match(view, /aria-label=\{`Open \$\{page\.title\}`\}/);
  assert.match(view, /group\/card/);
});

test("public and signed-in navigation do not advertise research", () => {
  for (const path of [
    "../page.tsx",
    "../../components/SiteHeader.tsx",
    "../../components/SiteFooter.tsx",
    "../../components/AppNav.tsx",
  ]) {
    assert.doesNotMatch(read(path), /href=[{\"']+\/research/);
  }
});
```

Before writing production files, name the production changes that make these
tests pass: a page performing the expected Supabase checks and metadata, plus a
view mapping the passed catalog to accessible `Link` cards. The discoverability
test already passes and protects the invariant during the change; the first two
tests must fail because their source files do not exist.

- [ ] **Step 2: Run the dashboard test and verify RED**

Run:

```bash
node --test --experimental-strip-types src/app/research/researchDashboard.test.ts
```

Expected: FAIL with `ENOENT` for `src/app/research/page.tsx` or
`ResearchDashboard.tsx`.

- [ ] **Step 3: Implement the presentation component**

Create `src/app/research/ResearchDashboard.tsx`. It must:

```tsx
import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { ResearchPage } from "./researchDashboard";

export function ResearchDashboard({
  pages,
}: {
  pages: readonly ResearchPage[];
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-ink">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.12),transparent_38%),radial-gradient(circle_at_90%_20%,rgba(232,121,249,0.08),transparent_32%)]"
      />
      <header className="relative mx-auto flex max-w-5xl items-center px-6 py-6 sm:px-8">
        <Logo href="/dashboard" />
      </header>
      <main className="relative mx-auto max-w-5xl px-6 pb-16 pt-10 sm:px-8 sm:pb-24 sm:pt-16">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.24em] text-cyan-glow">
          Private workspace
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Research
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
          Active PongLens studies, experiments, and review tools in one place.
        </p>

        <section
          aria-label="Research pages"
          className="mt-10 grid gap-4 md:grid-cols-2"
        >
          {pages.map((page, index) => {
            const cyan = page.accent === "cyan";
            return (
              <Link
                key={page.href}
                href={page.href}
                aria-label={`Open ${page.title}`}
                className="group/card relative min-h-56 overflow-hidden rounded-2xl border border-edge bg-surface/80 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-cyan-glow sm:p-7"
              >
                <div
                  aria-hidden="true"
                  className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${
                    cyan ? "via-cyan-glow/70" : "via-magenta-glow/70"
                  } to-transparent opacity-70`}
                />
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <p
                      className={`font-mono text-[11px] font-medium uppercase tracking-[0.2em] ${
                        cyan ? "text-cyan-glow" : "text-magenta-soft"
                      }`}
                    >
                      {page.category}
                    </p>
                    <h2 className="mt-4 text-xl font-semibold tracking-tight text-white sm:text-2xl">
                      {page.title}
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-zinc-600">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <p className="mt-5 max-w-md text-sm leading-6 text-zinc-400 sm:text-base">
                  {page.description}
                </p>
                <span
                  aria-hidden="true"
                  className={`absolute bottom-6 right-6 text-xl transition-transform duration-200 group-hover/card:translate-x-1 ${
                    cyan ? "text-cyan-glow" : "text-magenta-soft"
                  }`}
                >
                  →
                </span>
              </Link>
            );
          })}
        </section>

        <p className="mt-8 text-xs leading-5 text-zinc-600">
          Access is limited to approved PongLens research reviewers.
        </p>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Implement the protected server page**

Create `src/app/research/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResearchDashboard } from "./ResearchDashboard";
import {
  RESEARCH_PAGES,
  hasResearchDashboardAccess,
} from "./researchDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Research",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ResearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research");

  const [adminResult, reviewerResult] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase
      .from("research_reviewers")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const reviewerActive =
    !reviewerResult.error && reviewerResult.data?.active === true;
  if (
    !hasResearchDashboardAccess(
      adminResult.data === true,
      reviewerActive,
    )
  ) {
    notFound();
  }

  return <ResearchDashboard pages={RESEARCH_PAGES} />;
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
node --test --experimental-strip-types src/app/research/researchDashboard.test.ts
```

Expected: all dashboard tests PASS.

- [ ] **Step 6: Run type, lint, and complete focused-suite checks**

Run:

```bash
npx tsc --noEmit
npm run lint
npm run test:auth
npm run test:research
```

Expected: all commands exit 0 with no TypeScript or ESLint errors and no test
failures.

- [ ] **Step 7: Commit the protected dashboard**

```bash
git add src/app/research/page.tsx src/app/research/ResearchDashboard.tsx src/app/research/researchDashboard.test.ts
git commit -m "feat: add protected research dashboard"
```

### Task 3: Production Build and Visual Verification

**Files:**
- Modify only if verification finds an issue in the files from Tasks 1–2.

**Interfaces:**
- Consumes: the completed `/research` route.
- Produces: evidence that the production bundle and responsive presentation meet the approved design.

- [ ] **Step 1: Run a clean production build**

```bash
npm run build
```

Expected: Next.js exits 0 and lists `/research` as a dynamic route.

- [ ] **Step 2: Inspect the route at desktop and mobile widths**

Start the local app and open `/research` in an authenticated, approved reviewer
session. Inspect at approximately 1440×900 and 390×844. Confirm:

- Four cards are visible and each destination is correct.
- Cards form two columns on desktop and one column on mobile.
- No content clips or overflows at either viewport.
- Keyboard focus is visible on the logo and every card.
- The ambient treatment does not reduce text contrast.
- No research link appears on the public landing page or signed-in navigation.

If no authenticated local session is available, inspect the presentation
component in a temporary development-only render harness, then remove the
harness before committing. Do not weaken or bypass production authorization.

- [ ] **Step 3: Re-run complete verification after any visual adjustment**

```bash
npm run test:auth
npm run test:research
npx tsc --noEmit
npm run lint
npm run build
```

Expected: every command exits 0.

- [ ] **Step 4: Verify the final diff and requirements**

```bash
git status --short
git diff HEAD~2 -- src/app/research package.json
rg -n 'href=.*\/research' src/app src/components --glob '!src/app/research/**'
```

Expected: only the planned dashboard and package-script changes are present;
the final `rg` command returns no matches, and no sitemap file exists. Existing unrelated changes in
`supabase/.temp/cli-latest` and `scripts/demos/tutorial/` remain untouched.

- [ ] **Step 5: Commit visual fixes if Step 2 required any**

If and only if files changed during visual verification:

```bash
git add src/app/research/page.tsx src/app/research/ResearchDashboard.tsx src/app/research/researchDashboard.ts src/app/research/researchDashboard.test.ts package.json
git commit -m "style: refine research dashboard presentation"
```
