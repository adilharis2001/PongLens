/**
 * One account, two workspaces — the pure rules (157/158). Which side of
 * the app a request is on, decided the same way everywhere:
 *
 *   1. the route, when it is unambiguous (anything under /coaching/… is
 *      coach territory; the player's own rooms are player territory);
 *   2. the remembered choice, a cookie keyed by user so a shared browser
 *      never hands one account another's side;
 *   3. the account's coach flag, for a fresh device;
 *   4. player.
 *
 * Landing on unambiguous territory is sticky: the middleware writes the
 * cookie, so the shared pages that follow (a match, Account) keep the
 * same bar. No React, no Next — importable from middleware, server
 * components and client code alike, and tested with node --test.
 */

export type Workspace = "player" | "coach";

export const WORKSPACE_COOKIE = "pl-workspace";
export const WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function formatWorkspaceCookie(userId: string, ws: Workspace): string {
  return `${userId}:${ws}`;
}

/** The remembered side for THIS user, or null when the cookie is absent,
 *  malformed, or belongs to someone else who used the browser. */
export function parseWorkspaceCookie(
  raw: string | undefined | null,
  userId: string | null,
): Workspace | null {
  if (!raw || !userId) return null;
  const sep = raw.lastIndexOf(":");
  if (sep <= 0) return null;
  if (raw.slice(0, sep) !== userId) return null;
  const ws = raw.slice(sep + 1);
  return ws === "coach" || ws === "player" ? ws : null;
}

const PLAYER_PREFIXES = [
  "/dashboard",
  "/matches",
  "/upload",
  "/journal",
  "/improve",
  "/stats",
  "/starred",
  "/orders",
] as const;

/**
 * Which side a path belongs to, or null for shared ground. Bare
 * /coaching is shared: it renders whichever side the workspace says.
 * Everything beneath it (students, orders, offerings, your page) is the
 * coach's.
 */
export function routeTerritory(path: string): Workspace | null {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  if (clean.startsWith("/coaching/")) return "coach";
  for (const prefix of PLAYER_PREFIXES) {
    if (clean === prefix || clean.startsWith(`${prefix}/`)) return "player";
  }
  return null;
}

export function resolveWorkspace(input: {
  path: string;
  cookie: string | undefined | null;
  userId: string | null;
  isCoach: boolean;
}): { workspace: Workspace; byRoute: boolean } {
  const territory = routeTerritory(input.path);
  if (territory) return { workspace: territory, byRoute: true };
  const remembered = parseWorkspaceCookie(input.cookie, input.userId);
  if (remembered) return { workspace: remembered, byRoute: false };
  return { workspace: input.isCoach ? "coach" : "player", byRoute: false };
}

/** Where a sign-in lands when nothing more specific was asked for. */
export function signInDestination(input: {
  requested: string;
  cookie: string | undefined | null;
  userId: string | null;
  isCoach: boolean;
}): string {
  if (input.requested !== "/dashboard") return input.requested;
  const { workspace } = resolveWorkspace({
    path: "/",
    cookie: input.cookie,
    userId: input.userId,
    isCoach: input.isCoach,
  });
  return workspace === "coach" ? "/coaching" : "/dashboard";
}
