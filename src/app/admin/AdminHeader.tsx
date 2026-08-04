import Link from "next/link";

/** Subpage title with the way back up. */
export function AdminHeader({
  title,
  backHref = "/admin",
}: {
  title: string;
  backHref?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Link
        href={backHref}
        aria-label="Back"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-zinc-300 transition-colors hover:text-cyan-glow"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
        </svg>
      </Link>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
    </div>
  );
}
