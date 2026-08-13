# Marketing Hub Design

## Goal

A private page at `/marketing` that holds one card per marketing space, the
way `/research` holds one card per study. Each space becomes its own page
underneath it. The first space is coach outreach; more will follow, and the
hub is what keeps them in one place instead of scattered across bookmarks.

## Access

Two layers, the same two `/research` uses:

1. The central protected-path middleware requires a Supabase session. A
   signed-out visit lands on `/login?next=/marketing` and comes back after
   sign-in.
2. The page admits the admin, or an account carrying the `marketing` role.
   Anyone else gets the app's 404, so the page never confirms it exists.

The role lives in `app_roles`, the table QA introduced in 092, with its
check constraint widened to `('qa', 'marketing')`. Migration 100 adds
`is_marketing()` alongside `is_qa()`, plus `admin_list_marketing()` and
`admin_set_marketing()` for granting and revoking by email. All three are
security definer and re-check `is_admin()` themselves, so the page's render
check is UX rather than the boundary.

The three functions mirror the QA trio line for line rather than
generalising into one role API. Two roles is not enough to know what that
API should look like, and rewriting the QA call sites to find out would put
test billing at risk for nothing. Generalise when a third role arrives.

`is_marketing()` is also the function a future marketing table's RLS policy
should name, which is why it exists even though the page could have queried
`app_roles` directly.

Metadata sets `index: false`, `follow: false`, `nocache: true`. Nothing in
the landing page, site header, footer, app navigation or sitemap links to
`/marketing`.

## Page

No app chrome: the brand mark, the `Private workspace` eyebrow, the heading
`Marketing`, and a responsive grid of space cards, matching the research
dashboard so the two private workspaces read as the same kind of place. No
sentence under the heading.

Each card carries a category label, the space name, a plain description and
a directional arrow. A space with a page is one large keyboard-focusable
link. A space that has been agreed but not built renders as the same card
with nothing to press and a quiet `Not built yet` where the arrow would be.
The alternative was leaving planned spaces off the hub until their pages
exist, which hides what is being worked on from the one screen meant to
show it.

The catalog is a typed, immutable list in a server-safe module beside the
route, so every link is reviewable in code and the hub renders with no
database read.

Below the grid, and only for the admin, an `Access` card lists everyone
holding the marketing role with the date they got it, takes an email
address to grant, and removes in two presses. Removal is a bordered pill
that turns amber on hover, not a small grey link.

## Data flow

1. Middleware recognises `/marketing` through the protected prefix list.
2. The page calls `auth.getUser()`, redirecting to login without one.
3. It calls `is_admin` and `is_marketing` in parallel. A failed RPC returns
   null data, which reads as false, so the gate fails closed.
4. Neither true, `notFound()`.
5. Admin only: `admin_list_marketing()` fills the access card. Everyone else
   is handed null for that prop, which is what keeps the card off the page.

## Verification

`npm run test:marketing` covers the catalog, the access predicate, the
protected prefix, the route's login redirect and 404, the admin-only access
list, link-versus-card rendering, and that no navigation surface advertises
the route. Beyond that: `npm run test:auth`, `npm run test:research`, lint,
a real `npm run build` in a worktree, and a signed-in pass at 1280x800 and
393x660 for each of the four states (signed out, signed in without the
role, with the role, and admin).

## Non-goals

- No space pages yet. Coach outreach is the next conversation.
- No navigation link anywhere.
- No second roles table, and no generic role API.
