import { TESTFLIGHT_URL } from "@/lib/config";

/**
 * The one line an invite page owes a phone without the app. A phone that
 * has it never sees this page: the link opens the app instead. Everyone
 * else, on a phone or a laptop, learns the app exists and where it is
 * while PongLens is on TestFlight.
 */
export function GetTheApp() {
  return (
    <p className="mt-6 text-xs text-zinc-500">
      PongLens is also an iPhone app in beta.{" "}
      <a
        href={TESTFLIGHT_URL}
        target="_blank"
        rel="noreferrer"
        className="text-zinc-300 underline underline-offset-2"
      >
        Get it on TestFlight
      </a>
      .
    </p>
  );
}
