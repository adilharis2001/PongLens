# Research Dashboard Design

## Goal

Create a polished, focused dashboard at `/research` that gives every approved
research reviewer a clear path to every research page in PongLens. The route is
intentionally undiscoverable from public and signed-in navigation: people reach
it only by knowing the URL.

## Access and Privacy

The route uses the same two layers already established by the research tools:

1. The central protected-path middleware requires a valid Supabase session and
   app access. A signed-out visit returns to `/research` after successful login.
2. The page itself admits a PongLens admin or a user whose
   `research_reviewers` row has `active = true`.

An authenticated user without research access receives the app's 404 response.
This avoids confirming that the private dashboard exists. Admin access continues
to be determined by the existing `is_admin` RPC.

Every admitted reviewer sees the complete research catalog, regardless of which
research batches are currently assigned to that reviewer. The destination pages
retain their existing authorization and row-level data access checks.

The dashboard metadata sets `index: false`, `follow: false`, and `nocache: true`.
No link to `/research` is added to the landing page, site header, footer, app
navigation, sitemap, or any other discovery surface.

## Page Content and Interaction

The dashboard is a single-purpose page with no application navigation shell.
It contains:

- A compact PongLens brand mark that links to `/dashboard`.
- A restrained `Private workspace` eyebrow.
- The heading `Research` and a short sentence explaining that this is the home
  for active PongLens studies.
- A responsive grid of destination cards.
- A subtle footer note that access is limited to approved reviewers.

Each card is one large keyboard-focusable link. It contains a small category
label, a plain-language title, a concise description, and a directional arrow.
Cards use the existing dark visual language with low-contrast borders and
cyan/magenta accents. Hover treatment is modest and all motion respects the
project's existing reduced-motion rule.

The initial catalog is:

| Title | Category | Destination | Description |
| --- | --- | --- | --- |
| Fused labeling | Data labeling | `/research/fused-labeling` | Review synchronized audio and ball-tracking evidence to produce trusted point labels. |
| Placement calibration | Model calibration | `/research/placement-calibration` | Compare placement predictions and calibrate how landing locations map onto the table. |
| Serve detection | Model evaluation | `/research/serve-detection` | Label serve timing and inspect the latest temporal serve-detection results. |
| Point-ending research | Model evaluation | `/research/winner-constrained-endings` | Review winner-constrained point endings and identify the final decisive contact. |

## Architecture

The catalog lives in a small server-safe module beside the route. It exports a
typed, immutable list of research destinations. Keeping the route registry in
code makes every link reviewable, avoids adding a database-to-route mapping, and
ensures the dashboard still renders when a reviewer has no current assignments.

The server page owns authentication and authorization. After access succeeds,
it renders a presentation component with the catalog. The presentation component
has no data fetching or permission logic, so its markup and accessibility
contract can be tested independently.

No database migration or new dependency is required.

## Data Flow and Failure Behavior

1. The middleware recognizes `/research` through the existing protected prefix.
2. The server page calls `supabase.auth.getUser()`.
3. Without a user, it redirects to `/login?next=/research` as a page-level
   defense in depth.
4. With a user, it checks `is_admin` and the user's `research_reviewers` row in
   parallel.
5. If neither grants access, the page calls `notFound()`.
6. If access is granted, the static catalog is rendered.

If the reviewer lookup returns a database error, access is denied rather than
allowing the dashboard to fail open. Because the catalog itself is local and
static, there is no loading or empty state.

## Testing and Verification

Automated tests will verify:

- The catalog contains exactly the four existing research destinations with
  unique paths and non-empty user-facing copy.
- The dashboard renders every catalog item as a link.
- The page contains the login redirect, admin/reviewer allowlist check, 404
  denial, and private robots metadata.
- Existing protected-path behavior continues to classify `/research` as private.
- The public landing page and shared public navigation do not link to
  `/research`.

Verification includes the focused research-dashboard tests, the existing auth
and research test suites, linting, a production build, and a rendered desktop
and mobile visual inspection when the local environment supports authenticated
page rendering.

## Non-Goals

- No research assignment management.
- No progress metrics, filtering, search, or recent-activity feed.
- No new reviewer roles or access tables.
- No navigation link advertising the dashboard.
- No changes to the four destination research workflows.
