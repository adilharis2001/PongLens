import { NextResponse, type NextRequest } from "next/server";
import { repairAuthConfirmPath } from "@/lib/auth/paths";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Emails requested from the iOS app carried a malformed confirm link
  // ("/auth/confirm&token_hash=..." — the "&" belongs where a "?" should
  // be; see repairAuthConfirmPath). The app is fixed, but delivered
  // emails and installed builds keep producing the old shape, so the
  // button in those emails lands here as a path that would 404. Repair
  // and redirect; /auth/confirm judges the token like any other.
  const repaired = repairAuthConfirmPath(request.nextUrl.pathname);
  if (repaired) {
    const url = request.nextUrl.clone();
    url.pathname = repaired.pathname;
    url.search = repaired.search;
    return NextResponse.redirect(url);
  }

  // Safety net: if an OAuth code lands anywhere other than /auth/callback
  // (e.g. Supabase fell back to the Site URL because the requesting origin
  // wasn't allow-listed), forward it to the callback so sign-in completes.
  const { pathname, searchParams } = request.nextUrl;
  if (searchParams.has("code") && !pathname.startsWith("/auth/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets. Auth-protected routes
     * (/dashboard) are enforced inside updateSession.
     */
    "/((?!_next/static|_next/image|favicon.ico|img/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
