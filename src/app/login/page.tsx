import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { GoogleSignInButton } from "./GoogleSignInButton";

export const metadata: Metadata = {
  title: "Sign in",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <main className="bg-arena flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-edge bg-surface p-8">
          <h1 className="text-center text-xl font-semibold">Welcome back</h1>
          <p className="mt-2 text-center text-sm text-zinc-400">
            Sign in to upload matches and grab your results.
          </p>
          <GoogleSignInButton />
          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-500">
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
        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link href="/" className="transition-colors hover:text-white">
            ← Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
