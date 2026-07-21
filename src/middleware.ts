import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
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
