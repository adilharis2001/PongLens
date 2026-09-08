import { NextResponse } from "next/server";

/**
 * The file Apple reads to decide whether a ponglens.com link may open the
 * iPhone app. Apple's servers fetch it when the app is installed or
 * updated and cache what they find, so a change here reaches phones over
 * the following day, not the following minute.
 *
 * A route handler rather than a file in public/: the path has no
 * extension, the site sends X-Content-Type-Options: nosniff, and Apple
 * requires the JSON content type, so the type has to be set here rather
 * than guessed. Served on www only; the apex answers every request with
 * a redirect, which Apple does not follow, and every link the product
 * mints already uses www.
 *
 * ACUSR8S5R9 is the team, com.ponglens.PongLens the bundle identifier,
 * both from the Xcode project. The entitlement on the app side names the
 * domain; this side names the app and the paths. Only the two invite
 * pages are claimed: the app has screens for those and nothing else yet,
 * and a claimed path with no screen behind it would open the app onto
 * nothing.
 */
const APP_ID = "ACUSR8S5R9.com.ponglens.PongLens";

export function GET() {
  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [APP_ID],
            components: [{ "/": "/join/*" }, { "/": "/coach-invite/*" }],
          },
        ],
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}
