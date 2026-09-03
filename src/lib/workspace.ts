"use client";

import { useEffect, useState } from "react";
import {
  WORKSPACE_COOKIE,
  WORKSPACE_COOKIE_MAX_AGE,
  formatWorkspaceCookie,
  parseWorkspaceCookie,
  routeTerritory,
  type Workspace,
} from "@/lib/workspaceModel";

export type { Workspace } from "@/lib/workspaceModel";

/**
 * The client half of the workspace choice (158). The value lives in a
 * cookie so the server renders the right nav on the first paint and the
 * sign-in flow can read it; keyed by user so a shared browser never hands
 * one account another's side. Server components resolve it with
 * `rememberedWorkspace()` and pass it down; this module only writes it
 * and keeps a page in step after a same-page switch.
 */

const EVENT = "pl-workspace-changed";

function readCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const hit = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${WORKSPACE_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(WORKSPACE_COOKIE.length + 1)) : undefined;
}

export function getWorkspace(userId: string | null): Workspace {
  return parseWorkspaceCookie(readCookie(), userId) ?? "player";
}

export function setWorkspace(userId: string, value: Workspace) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${WORKSPACE_COOKIE}=${encodeURIComponent(
    formatWorkspaceCookie(userId, value),
  )}; Path=/; Max-Age=${WORKSPACE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}

/**
 * Landing on unambiguous territory is sticky (158): a coach link from a
 * notification switches the remembered side, so the shared pages that
 * follow (a match, Account) keep the same bar. Written from the page
 * that rendered, which only a real visit does. It used to be the
 * middleware's job, and the middleware also runs for the router's
 * prefetch of every link in view — with Next's prefetch header stripped
 * before it looks — so a match page's link to /matches switched a coach
 * to the player side the moment they opened a student's match.
 */
export function rememberLanding(userId: string, pathname: string) {
  const territory = routeTerritory(pathname);
  if (!territory) return;
  if (parseWorkspaceCookie(readCookie(), userId) === territory) return;
  setWorkspace(userId, territory);
}

/**
 * Starts from what the server resolved (no hydration mismatch, no flash),
 * follows the prop when a navigation re-renders the shell, and follows a
 * same-page switch through the event.
 */
export function useWorkspace(initial: Workspace): Workspace {
  const [workspace, setState] = useState<Workspace>(initial);
  useEffect(() => {
    setState(initial);
  }, [initial]);
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Workspace>).detail;
      if (detail === "coach" || detail === "player") setState(detail);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return workspace;
}
