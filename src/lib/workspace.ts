"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Which side of the app this account is using: playing or coaching (156).
 * One account, two workspaces — the choice only changes what the chrome
 * shows, never what RLS allows, so a device-local value is enough. It is
 * keyed by user (157): a browser-wide value let a student inherit the
 * coach nav after a coach had used the same browser.
 */

export type Workspace = "player" | "coach";

const PREFIX = "pl-workspace:";
const EVENT = "pl-workspace-changed";

function key(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function getWorkspace(userId: string | null): Workspace {
  if (typeof window === "undefined" || !userId) return "player";
  return window.localStorage.getItem(key(userId)) === "coach"
    ? "coach"
    : "player";
}

export function setWorkspace(userId: string, value: Workspace) {
  window.localStorage.setItem(key(userId), value);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Hydrates "player" (matching the server render), then resolves the
 * signed-in user and reads their choice in an effect — reading storage
 * during render is a hydration mismatch. Listens for same-tab switches;
 * the storage event covers other tabs; an auth change re-reads for the
 * new user.
 */
export function useWorkspace(): Workspace {
  const [workspace, setState] = useState<Workspace>("player");
  useEffect(() => {
    const supabase = createClient();
    let userId: string | null = null;
    const read = () => setState(getWorkspace(userId));
    void supabase.auth.getSession().then(({ data }) => {
      userId = data.session?.user.id ?? null;
      read();
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      userId = session?.user.id ?? null;
      read();
    });
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return workspace;
}
