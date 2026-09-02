import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  WORKSPACE_COOKIE,
  resolveWorkspace,
  type Workspace,
} from "@/lib/workspaceModel";

/**
 * The remembered side for the signed-in user, for server components that
 * render the chrome (158). Reads the session from the auth cookie without
 * a round trip — this decides which nav to draw, never what a user may
 * read, so an unverified claim is fine here. Route territory is applied
 * by the nav itself, which knows the path.
 */
export async function rememberedWorkspace(): Promise<{
  workspace: Workspace;
  userId: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id ?? null;
  const isCoach = session?.user.user_metadata?.is_coach === true;
  const cookieStore = await cookies();
  const { workspace } = resolveWorkspace({
    path: "/",
    cookie: cookieStore.get(WORKSPACE_COOKIE)?.value,
    userId,
    isCoach,
  });
  return { workspace, userId };
}
