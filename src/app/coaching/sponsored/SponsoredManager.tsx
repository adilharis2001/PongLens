"use client";

/**
 * Sponsored reviews (096): the coach covers a review for a student they
 * already coach. Pick an offering, get a single-use link, send it — the
 * student pays nothing and one sponsored credit is used when they accept.
 * New coaches start with a free allowance; more come in prepaid packs.
 */

import { useCallback, useEffect, useState } from "react";

import type { SponsoredPack } from "@/lib/commerce/packs";
import { PackTiles } from "@/components/PackTiles";
import { UpLink } from "@/components/UpLink";
import { formatUsd } from "@/lib/reviews/money";
import { createClient } from "@/lib/supabase/client";

interface OfferingChoice {
  id: string;
  title: string;
  active: boolean;
}

interface InviteRow {
  id: string;
  token: string;
  offering_id: string;
  status: string;
  created_at: string;
}

export function SponsoredManager({
  offerings,
  packs,
}: {
  offerings: OfferingChoice[];
  packs: SponsoredPack[];
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [pickedOffering, setPickedOffering] = useState<string | null>(null);
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = offerings.filter((o) => o.active);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [balanceRes, invitesRes, configRes] = await Promise.all([
      supabase.from("sponsored_credit_ledger").select("credits, kind"),
      supabase
        .from("sponsored_invites")
        .select("id, token, offering_id, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("app_config")
        .select("value")
        .eq("key", "sponsored_free_credits")
        .maybeSingle(),
    ]);
    if (balanceRes.data) {
      // The free allowance lands lazily on first use, so an untouched
      // ledger means the allowance is still WAITING, not spent.
      const sum = balanceRes.data.reduce((s, r) => s + (r.credits ?? 0), 0);
      const hasGrant = balanceRes.data.some((r) => r.kind === "grant");
      const free = Number(configRes.data?.value ?? "3");
      setBalance(
        sum + (hasGrant ? 0 : Number.isFinite(free) && free > 0 ? free : 0),
      );
    }
    setInvites((invitesRes.data ?? []) as InviteRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mint = async () => {
    if (!pickedOffering || busy) return;
    setBusy(true);
    setError(null);
    setMintedUrl(null);
    const supabase = createClient();
    const { data, error: mintError } = await supabase.rpc(
      "mint_sponsored_invite",
      { p_offering_id: pickedOffering },
    );
    setBusy(false);
    if (mintError) {
      setError(
        mintError.message.includes("no_sponsored_credits")
          ? "No sponsored reviews left. Get a pack below."
          : "Could not create the link. Try again.",
      );
      return;
    }
    const token = (data as { token?: string } | null)?.token;
    if (token) {
      setMintedUrl(`${window.location.origin}/review-invite/${token}`);
      setCopied(false);
      void load();
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The URL is on screen either way.
    }
  };

  const revoke = async (id: string) => {
    const supabase = createClient();
    await supabase
      .from("sponsored_invites")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", id);
    void load();
  };

  const buyPack = async (packKey: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "sponsored_pack",
          packKey,
          next: "/coaching/offerings",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError("Checkout did not open. Try again.");
        return;
      }
      window.location.assign(data.url);
    } finally {
      setBusy(false);
    }
  };

  const offeringTitle = (id: string) =>
    offerings.find((o) => o.id === id)?.title ?? "Offering";

  return (
    <div className="mx-auto max-w-2xl">
      <UpLink href="/coaching" label="Coaching" />
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        Sponsored reviews
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        For students you already coach. They use your link, send a match,
        and pay nothing.
      </p>

      <section className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <p className="text-sm font-medium text-zinc-200">
        {balance === null
          ? "Reading your balance…"
          : balance === 1
            ? "You have 1 sponsored review."
            : `You have ${balance} sponsored reviews.`}
      </p>
      {active.length > 0 && (balance ?? 0) > 0 && (
        <p className="mt-2 text-sm text-zinc-400">
          Pick the offering, create the link, send it to your student.
        </p>
      )}

      {active.length > 0 && (balance ?? 0) > 0 && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {active.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={pickedOffering === o.id}
                onClick={() =>
                  setPickedOffering(pickedOffering === o.id ? null : o.id)
                }
                className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                  pickedOffering === o.id
                    ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                    : "border-edge text-zinc-300 hover:border-cyan-glow/30"
                }`}
              >
                {o.title}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void mint()}
            disabled={!pickedOffering || busy}
            className="glow-cta mt-3 rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-50"
          >
            Create the link
          </button>
        </>
      )}

      {mintedUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl border border-edge bg-surface-2/60 px-3 py-2 text-xs text-zinc-300">
            {mintedUrl}
          </code>
          <button
            type="button"
            onClick={() => void copy(mintedUrl)}
            className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 hover:border-cyan-glow/50 hover:text-white"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}

      {invites.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-edge/60 pt-3">
          {invites.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between gap-3 text-xs text-zinc-500"
            >
              <span className="min-w-0 truncate">
                {offeringTitle(inv.offering_id)} · waiting to be used
              </span>
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void copy(
                      `${window.location.origin}/review-invite/${inv.token}`,
                    )
                  }
                  className="text-zinc-400 underline-offset-2 hover:underline"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={() => void revoke(inv.id)}
                  className="text-zinc-400 underline-offset-2 hover:text-amber-300 hover:underline"
                >
                  Revoke
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      </section>

      {packs.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Get more
          </h2>
          <PackTiles
            tiles={packs.map((p) => ({
              key: p.key,
              amount: String(p.credits),
              unit: p.credits === 1 ? "review" : "reviews",
              price: formatUsd(p.priceCents),
              note: `${formatUsd(Math.round(p.priceCents / p.credits))} a review`,
            }))}
            busy={busy}
            onPick={(key) => void buyPack(key)}
          />
        </section>
      )}
    </div>
  );
}
