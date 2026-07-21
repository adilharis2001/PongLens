import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">Last updated: {updated}</p>
          <div className="prose-legal mt-10 space-y-8 text-[15px] leading-relaxed text-zinc-300 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_a]:text-cyan-glow [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-3">
            {children}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
