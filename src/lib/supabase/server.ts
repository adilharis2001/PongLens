import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

export async function createClient() {
  const headerStore = await headers();
  const authHeader = headerStore.get("authorization");

  // Native clients (the iOS app) authenticate with a bearer token instead of
  // cookies. Seeding the session from the token lets every route's
  // auth.getUser() and RLS-scoped query work unchanged. The refresh token is
  // a placeholder on purpose: refresh belongs to the app; an expired access
  // token should 401 here so the app refreshes and retries.
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    // A real in-memory store, not a no-op: setSession writes the session
    // through this adapter and every later query reads the token back out
    // of it. With a no-op store the client silently falls back to anon.
    let memoryStore: { name: string; value: string }[] = [];
    const client = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return memoryStore;
          },
          setAll(cookiesToSet) {
            memoryStore = cookiesToSet.map(({ name, value }) => ({ name, value }));
          },
        },
      }
    );
    await client.auth.setSession({
      access_token: authHeader.slice("bearer ".length).trim(),
      refresh_token: "native-client",
    });
    return client;
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore when
            // middleware is refreshing sessions.
          }
        },
      },
    }
  );
}
