import Link from "next/link";
import { Logo } from "./Logo";
import { getSupportEmail } from "@/lib/config";

export async function SiteFooter() {
  const supportEmail = await getSupportEmail();
  return (
    <footer className="border-t border-edge/70 bg-ink">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-12 sm:flex-row sm:justify-between">
        <div className="flex flex-col items-center gap-3 sm:items-start">
          <Logo />
          <p className="text-sm text-zinc-500">
            AI match analysis for table tennis players.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:items-end">
          <nav className="flex items-center gap-6 text-sm text-zinc-400">
            <Link href="/terms" className="transition-colors hover:text-white">
              Terms
            </Link>
            <Link
              href="/privacy"
              className="transition-colors hover:text-white"
            >
              Privacy
            </Link>
            <a
              href={`mailto:${supportEmail}`}
              className="transition-colors hover:text-white"
            >
              Contact
            </a>
          </nav>
          <p className="text-sm text-zinc-500">© 2026 PongLens</p>
        </div>
      </div>
    </footer>
  );
}
