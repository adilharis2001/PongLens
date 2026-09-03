import Link from "next/link";
import { AuthButton } from "./AuthButton";
import { Logo } from "./Logo";

export function SiteHeader({
  audience = "players",
}: {
  /**
   * Which side of the product this page speaks to. The header carries one
   * audience link, mirrored: player-facing pages point at /coaches, and the
   * coaches page points back home — a link to the page you are on is not
   * navigation. Unlike "Features", the audience link stays visible on
   * phones: a coach opening the site from a link on their phone is exactly
   * who it exists for.
   */
  audience?: "players" | "coaches";
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-edge/70 bg-ink/80 backdrop-blur-md">
      {/* px-4 below sm: with the audience link now always visible, the
          signed-in state (logo + "For coaches" + "Open PongLens") needs
          every one of these pixels on a 393px phone. */}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2 sm:gap-6">
          {audience === "coaches" ? (
            <Link
              href="/"
              className="whitespace-nowrap text-sm text-zinc-400 transition-colors hover:text-white"
            >
              For players
            </Link>
          ) : (
            <>
              <Link
                href="/#features"
                className="hidden text-sm text-zinc-400 transition-colors hover:text-white sm:block"
              >
                Features
              </Link>
              <Link
                href="/coaches"
                className="whitespace-nowrap text-sm text-zinc-400 transition-colors hover:text-white"
              >
                For coaches
              </Link>
            </>
          )}
          <AuthButton />
        </nav>
      </div>
    </header>
  );
}
