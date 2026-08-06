/**
 * The app's one section heading: a small uppercase eyebrow label over a
 * card group, the iOS grouped-screen convention. Every app-chrome section
 * on every tab uses this; larger title-style headings are reserved for
 * CONTENT (a delivered review's own sections, the storefront a visitor
 * reads) — chrome labels, content titles.
 */
export function SectionHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-xs font-semibold uppercase tracking-wider text-zinc-500 ${className}`}
    >
      {children}
    </h2>
  );
}
