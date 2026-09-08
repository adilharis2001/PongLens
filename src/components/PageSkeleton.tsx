import { AppShell } from "@/components/AppShell";

/**
 * What a page shows while its server component is still resolving.
 *
 * Every signed-in page waits on the same two things before it can render:
 * the middleware validating the session with Supabase, and the page's own
 * `getUser()`, which is a second round trip. On a good connection that is
 * a couple of hundred milliseconds; on a bad one it is seconds. With no
 * loading file the App Router keeps the PREVIOUS page on screen for all of
 * it, so a tap produced nothing at all and the app read as frozen. Adil
 * described exactly that on My game.
 *
 * The title is passed in so the frame that appears is the frame you asked
 * for, rather than a generic spinner that could be anything.
 */
export function PageSkeleton({
  title,
  wide = false,
  hasFab = false,
  rows = 4,
}: {
  title: string;
  wide?: boolean;
  hasFab?: boolean;
  rows?: number;
}) {
  return (
    <AppShell avatarUrl={null} wide={wide} hasFab={hasFab}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      <div className="mt-6 space-y-3" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-edge bg-surface"
          />
        ))}
      </div>
    </AppShell>
  );
}
