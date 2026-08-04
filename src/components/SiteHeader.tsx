import Link from "next/link";
import { Logo } from "./Logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-edge/70 bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-2 sm:gap-6">
          <Link
            href="/#features"
            className="hidden text-sm text-zinc-400 transition-colors hover:text-white sm:block"
          >
            Features
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-cyan-glow/40 px-4 py-1.5 text-sm font-medium text-cyan-glow transition-colors hover:border-cyan-glow hover:bg-cyan-glow/10"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
