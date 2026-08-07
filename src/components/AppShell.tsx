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
  children,
}: {
  avatarUrl: string | null;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <AppNav avatarUrl={avatarUrl} wide={wide} />
      <main className="bg-arena flex-1 pb-32 md:pb-16">
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
