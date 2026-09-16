"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AiConsentContext,
  AiConsentSheet,
  fetchConsentInfo,
  type AiConsentContextValue,
  type EnsureOptions,
} from "@/components/AiConsentSheet";

/**
 * Mounted once, in the root layout, so every signed-in surface (the match
 * page included, which skips AppShell) can call useAiConsent(). Nothing
 * is fetched until a feature asks: signed-out pages pay nothing for it.
 *
 * The sheet is rendered here rather than inside the page column, because
 * AppShell's .page-enter holds a transform for its entry animation and a
 * fixed sheet inside it would size to the column for that beat.
 */
export function AiConsentProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // The live answer, for an ensure() awaited across renders.
  const enabledRef = useRef<boolean | null>(null);
  // Whether /api/consent has answered. A failed read stays unknown so the
  // next ensure() tries again instead of asking a person who already said
  // yes.
  const knownRef = useRef(false);
  const loadingRef = useRef<Promise<void> | null>(null);
  const waitingRef = useRef<((ok: boolean) => void)[]>([]);

  const setEnabled = useCallback((value: boolean | null) => {
    enabledRef.current = value;
    setEnabledState(value);
  }, []);

  const load = useCallback(async () => {
    if (!loadingRef.current) {
      loadingRef.current = (async () => {
        const info = await fetchConsentInfo();
        if (!info) return;
        knownRef.current = true;
        setVersion(info.aiConsentVersion);
        setEnabled(info.aiFeaturesEnabled);
      })().finally(() => {
        loadingRef.current = null;
      });
    }
    await loadingRef.current;
  }, [setEnabled]);

  const ensure = useCallback(
    async (options?: EnsureOptions): Promise<boolean> => {
      if (options?.reask) {
        // The server refused, so whatever we cached is wrong.
        knownRef.current = true;
        setEnabled(false);
      } else {
        // Read through a function: TypeScript keeps a narrowing on the ref
        // across the await, and the answer can change during load().
        const allowed = () => enabledRef.current === true;
        if (allowed()) return true;
        if (!knownRef.current) await load();
        if (allowed()) return true;
      }
      return new Promise<boolean>((resolve) => {
        waitingRef.current.push(resolve);
        setOpen(true);
      });
    },
    [load, setEnabled],
  );

  const settle = useCallback(
    (ok: boolean) => {
      setOpen(false);
      if (ok) {
        knownRef.current = true;
        setEnabled(true);
      }
      const waiting = waitingRef.current;
      waitingRef.current = [];
      waiting.forEach((resolve) => resolve(ok));
    },
    [setEnabled],
  );

  const onAllow = useCallback(() => settle(true), [settle]);
  const onNotNow = useCallback(() => settle(false), [settle]);

  const value = useMemo<AiConsentContextValue>(
    () => ({
      enabled,
      ensure,
      setEnabled: (next: boolean) => {
        knownRef.current = true;
        setEnabled(next);
      },
    }),
    [enabled, ensure, setEnabled],
  );

  return (
    <AiConsentContext.Provider value={value}>
      {children}
      <AiConsentSheet
        open={open}
        version={version}
        onAllow={onAllow}
        onNotNow={onNotNow}
      />
    </AiConsentContext.Provider>
  );
}
