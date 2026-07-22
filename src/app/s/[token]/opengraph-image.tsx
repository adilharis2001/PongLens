import { ImageResponse } from "next/og";
import {
  playersLine,
  pointContextLine,
  type ResolvedShareLink,
} from "./shareData";

/**
 * Dynamic OG card for /s/[token]: dark branded, text-only (no video frame
 * extraction in v1). Resolution uses the anon REST endpoint directly — the
 * OG renderer has no cookies, and resolve_share_link() is anon-executable.
 * Unknown/revoked tokens get the generic PongLens card.
 */

export const runtime = "nodejs";
export const alt = "Watch on PongLens";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function resolve(token: string): Promise<ResolvedShareLink | null> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const res = await fetch(`${url}/rest/v1/rpc/resolve_share_link`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: token }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ResolvedShareLink[];
    return data?.[0] ?? null;
  } catch {
    return null;
  }
}

export default async function OgImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await resolve(token);

  const names = link ? playersLine(link) : null;
  const big = !link
    ? "Match analysis for table tennis"
    : link.kind === "point"
      ? pointContextLine(link)
      : names
        ? `Match · ${names}`
        : "Match";
  const sub = !link
    ? "ponglens.com"
    : link.kind === "point" && names
      ? names
      : "Watch it on PongLens";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#0a0a0f",
          backgroundImage:
            "radial-gradient(ellipse 70% 55% at 50% -10%, rgba(34, 211, 238, 0.18), transparent 60%), radial-gradient(ellipse 45% 40% at 88% 20%, rgba(232, 121, 249, 0.10), transparent 60%)",
          fontFamily: "sans-serif",
        }}
      >
        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 9999,
              border: "5px solid #22d3ee",
              display: "flex",
            }}
          />
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>
            <span style={{ color: "#ffffff" }}>Pong</span>
            <span style={{ color: "#22d3ee" }}>Lens</span>
          </div>
        </div>

        {/* context */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              color: "#fafafa",
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            {big}
          </div>
          <div style={{ fontSize: 36, color: "#a1a1aa" }}>{sub}</div>
        </div>

        {/* footer strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: "#22d3ee",
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            <svg width="26" height="30" viewBox="0 0 26 30">
              <path d="M1 1v28l24-14L1 1Z" fill="#22d3ee" />
            </svg>
            Watch the video
          </div>
          <div style={{ fontSize: 28, color: "#52525b" }}>ponglens.com</div>
        </div>
      </div>
    ),
    size
  );
}
