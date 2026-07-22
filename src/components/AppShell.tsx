import { AppNav } from "@/components/AppNav";

/**
 * Shared chrome for signed-in pages: nav (top header on desktop, bottom
 * bar on mobile) plus a padded content column. Bottom padding clears the
 * fixed mobile bar.
 */
export function AppShell({
  avatarUrl,
  children,
}: {
  avatarUrl: string | null;
  children: React.ReactNode;
}) {
  return (
    <>
      <AppNav avatarUrl={avatarUrl} />
      <main className="bg-arena flex-1 pb-32 md:pb-16">
        <div className="page-enter mx-auto w-full max-w-4xl px-5 pt-8 sm:px-6 md:pt-12">
          {children}
        </div>
      </main>
    </>
  );
}
