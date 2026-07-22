"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Account — active public share links (Share mode v1), each with Revoke.
 * Separate from SharingSection (coach links stay where they are): these
 * links are open to anyone, so the list is the owner's kill switch.
 */

interface ShareLinkRow {
  id: string;
  kind: "point" | "match" | "starred";
  match_id: string;
  point_id: string | null;
  token: string;
  title: string | null;
  created_at: string;
}

function kindLabel(kind: ShareLinkRow["kind"]) {
  return kind === "point"
    ? "Point"
    : kind === "starred"
      ? "Starred points"
      : "Match";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ShareLinksSection() {
  const [links, setLinks] = useState<ShareLinkRow[] | null>(null);
  const [matchNames, setMatchNames] = useState<Map<string, string>>(new Map());
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("share_links")
      .select("id, kind, match_id, point_id, token, title, created_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as ShareLinkRow[];
    setLinks(rows);
    const matchIds = [...new Set(rows.map((l) => l.match_id))];
    if (matchIds.length > 0) {
      const { data: matches } = await supabase
        .from("matches")
        .select("id, opponent_name")
        .in("id", matchIds);
      setMatchNames(
        new Map(
          (matches ?? []).map((m) => [
            m.id as string,
            (m.opponent_name as string | null)?.trim() || "Match",
          ])
        )
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = useCallback(
    async (link: ShareLinkRow) => {
      setRevoking(link.id);
      setError(null);
      try {
        const res = await fetch("/api/share/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: link.id }),
        });
        if (!res.ok) throw new Error("revoke failed");
        await load();
      } catch {
        setError("Couldn't revoke. Try again.");
      } finally {
        setRevoking(null);
      }
    },
    [load]
  );

  const copy = useCallback(async (link: ShareLinkRow) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/s/${link.token}`
      );
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard blocked; nothing else to do
    }
  }, []);

  return (
    <section>
      <h2 className="text-lg font-semibold">Share links</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Public links you created. Anyone with a link can watch until you
        revoke it.
      </p>

      {links !== null && links.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">
          Links you share appear here.
        </p>
      )}

      {links !== null && links.length > 0 && (
        <ul className="mt-4 space-y-3">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-200">
                  {link.title?.trim() ||
                    `${kindLabel(link.kind)} · ${matchNames.get(link.match_id) ?? "Match"}`}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {link.title?.trim() ? `${kindLabel(link.kind)} · ` : ""}
                  Created {formatDate(link.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copy(link)}
                  className="rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
                >
                  {copiedId === link.id ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={() => void revoke(link)}
                  disabled={revoking === link.id}
                  className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:border-red-400 disabled:opacity-60"
                >
                  {revoking === link.id ? "Revoking…" : "Revoke"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
