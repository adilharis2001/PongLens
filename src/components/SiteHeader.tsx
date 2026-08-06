import Link from "next/link";
import { AuthButton } from "./AuthButton";
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
          <AuthButton />
        </nav>
      </div>
    </header>
  );
}
