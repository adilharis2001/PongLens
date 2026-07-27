import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { loginErrorMessage, safeNextPath } from "@/lib/auth/paths";
import { EmailSignInForm } from "./EmailSignInForm";
import { GoogleSignInButton } from "./GoogleSignInButton";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to PongLens to upload matches and grab your results.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: true },
  openGraph: {
    title: "Sign in · PongLens",
    description: "Sign in to PongLens to upload matches and grab your results.",
    url: "/login",
    siteName: "PongLens",
    images: ["/img/og.jpg"],
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext = safeNextPath(next);
  const authError = loginErrorMessage(error);
  return (
    <main className="bg-arena flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-edge bg-surface p-8">
          <h1 className="text-center text-xl font-semibold">
            Sign in to PongLens
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-400">
            Upload a match or pick up where you left off.
          </p>
          {authError && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-center text-xs leading-relaxed text-red-300"
            >
              {authError}
            </p>
          )}
          <GoogleSignInButton next={safeNext} />
          <EmailSignInForm next={safeNext} />
          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400">
            By signing in you agree to our{" "}
            <Link
              href="/terms"
              className="text-zinc-300 underline underline-offset-2 hover:text-cyan-glow"
            >
              Terms
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="text-zinc-300 underline underline-offset-2 hover:text-cyan-glow"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <p className="mt-6 text-center text-sm text-zinc-400">
          <Link href="/" className="transition-colors hover:text-white">
            ← Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
