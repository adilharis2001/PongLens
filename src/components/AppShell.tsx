import { AppNav } from "@/components/AppNav";

/**
 * Shared chrome for signed-in pages: nav (top header on desktop, bottom
 * bar on mobile) plus a padded content column. Bottom padding clears the
 * fixed mobile bar. `wide` widens the column (and the header with it, so
 * their edges stay aligned) for pages that lay out side-by-side on a
 * laptop — the coaching hub and workspace.
 */
export function AppShell({
  avatarUrl,
  wide,
  hasFab,
  children,
}: {
  avatarUrl: string | null;
  wide?: boolean;
  /**
   * This page floats an action over its content (Home, Matches, Journal).
   * The base padding only ever cleared the fixed nav bar, so the button
   * sat on top of whatever ended up last — a library card's title, a
   * checklist row. Only the pages that float one pay for the extra.
   */
  hasFab?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <AppNav avatarUrl={avatarUrl} wide={wide} />
      <main
        className={`bg-arena flex-1 ${
          hasFab ? "pb-48 md:pb-32" : "pb-32 md:pb-16"
        }`}
      >
        <div
          className={`page-enter mx-auto w-full px-5 pt-8 sm:px-6 md:pt-12 ${
            wide ? "max-w-6xl" : "max-w-4xl"
          }`}
        >
          {children}
        </div>
      </main>
    </>
  );
}
