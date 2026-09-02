"use client";

import { useEffect, useState } from "react";

/**
 * Which side of the app this browser is using: playing or coaching (156).
 * One account, two workspaces — the choice only changes what the chrome
 * shows, never what RLS allows, so a device-local value is enough. Same
 * scoping precedent as the "pl-coach-tab" session cache.
 */

export type Workspace = "player" | "coach";

const KEY = "pl-workspace";
const EVENT = "pl-workspace-changed";

export function getWorkspace(): Workspace {
  if (typeof window === "undefined") return "player";
  return window.localStorage.getItem(KEY) === "coach" ? "coach" : "player";
}

export function setWorkspace(value: Workspace) {
  window.localStorage.setItem(KEY, value);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Hydrates "player" (matching the server render), then flips from
 * storage in the first effect — reading storage during render is a
 * hydration mismatch. Listens for same-tab switches; the storage event
 * covers other tabs.
 */
export function useWorkspace(): Workspace {
  const [workspace, setState] = useState<Workspace>("player");
  useEffect(() => {
    const read = () => setState(getWorkspace());
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return workspace;
}
