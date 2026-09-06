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
   * who it exists for. The phone row stays calm because the signed-in
   * button shortens itself below sm (see AuthButton), not because anything
   * here squeezes.
   */
  audience?: "players" | "coaches";
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-edge/70 bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-4 sm:gap-6">
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
