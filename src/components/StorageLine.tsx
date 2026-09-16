"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { StorageState } from "@/lib/quota";
import { createClient } from "@/lib/supabase/client";

const GB = 1024 ** 3;

function gb(n: number) {
  const v = (n / GB).toFixed(1);
  return v.endsWith(".0") ? v.slice(0, -2) : v;
}

/**
 * One line of storage, for the screens where a large upload starts
 * outside the Account page: "12.4 of 25 GB used", red once full, with
 * the way to Account. The number is the same one the upload route will
 * check, so what the coach sees before choosing a video is what the
 * server will say after.
 */
export function StorageLine({ className = "" }: { className?: string }) {
  const [state, setState] = useState<StorageState | null>(null);

  useEffect(() => {
    let live = true;
    void createClient()
      .rpc("my_storage_state")
      .single()
      .then(({ data }) => {
        if (live && data) setState(data as StorageState);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!state) return null;
  const used = state.used_bytes;
  const limit = state.storage_limit_bytes;
  const full = used >= limit;
  return (
    <p className={`text-sm ${full ? "text-red-400" : "text-zinc-400"} ${className}`}>
      {gb(used)} of {gb(limit)} GB of storage used.{" "}
      <Link href="/account#storage" className="text-cyan-glow hover:underline">
        Account
      </Link>
    </p>
  );
}
