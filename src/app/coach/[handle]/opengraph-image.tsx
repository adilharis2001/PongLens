import { ImageResponse } from "next/og";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";

/**
 * Dynamic OG card for a coach's storefront: the coach's own photo, name,
 * and headline instead of the generic PongLens card. A coach shares this
 * link with students over WhatsApp and Instagram, and the preview is the
 * first thing a student sees — it should look like the coach, not like
 * an ad for us.
 *
 * Data comes from the same anon-callable coach_page() RPC the page uses
 * (the OG renderer has no cookies). The photo is fetched server-side and
 * embedded as a data URI, re-encoded through sharp because coaches can
 * upload WebP and satori only decodes JPEG/PNG. Any failure along the way
 * degrades to the text card — a missing picture must never cost the
 * preview entirely.
 */

export const runtime = "nodejs";
export const alt = "Coach on PongLens";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface CoachCard {
  display_name: string;
  headline: string | null;
  bio: string | null;
  photo_path: string | null;
}

async function loadCoach(handle: string): Promise<CoachCard | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/i.test(handle)) return null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const res = await fetch(`${url}/rest/v1/rpc/coach_page`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_handle: handle.toLowerCase() }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as CoachCard | null) ?? null;
  } catch {
    return null;
  }
}

/** The photo as a PNG data URI satori can draw, or null. */
async function loadPhoto(photoPath: string | null): Promise<string | null> {
  const key = photoPath?.match(/^r2:\/\/ponglens-media\/(.+)$/)?.[1];
  if (!key) return null;
  try {
    const signed = await presignGet(MEDIA_BUCKET, key);
    const res = await fetch(signed, { cache: "no-store" });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.byteLength > 8 * 1024 * 1024) return null;
    const sharp = (await import("sharp")).default;
    // 460px square cover crop: the card slot's exact size, so the data
    // URI stays small and satori does no scaling of its own.
    const png = await sharp(raw)
      .resize(460, 460, { fit: "cover" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function OgImage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const coach = await loadCoach((await params).handle);
  const photo = coach ? await loadPhoto(coach.photo_path) : null;

  const name = coach?.display_name?.trim() || "Coach";
  const line =
    coach?.headline?.trim() ||
    coach?.bio?.trim().slice(0, 90) ||
    "Match review by a real coach";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: 72,
          gap: 64,
          backgroundColor: "#0a0a0f",
          backgroundImage:
            "radial-gradient(ellipse 70% 55% at 50% -10%, rgba(34, 211, 238, 0.18), transparent 60%), radial-gradient(ellipse 45% 40% at 88% 20%, rgba(232, 121, 249, 0.10), transparent 60%)",
          fontFamily: "sans-serif",
        }}
      >
        {photo && (
          <img
            src={photo}
            width={460}
            height={460}
            style={{
              borderRadius: 32,
              border: "2px solid rgba(34, 211, 238, 0.35)",
            }}
          />
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: 460,
            flex: 1,
            minWidth: 0,
          }}
        >
          {/* wordmark */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 9999,
                border: "4px solid #22d3ee",
                display: "flex",
              }}
            />
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>
              <span style={{ color: "#ffffff" }}>Pong</span>
              <span style={{ color: "#22d3ee" }}>Lens</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                fontSize: name.length > 18 ? 60 : 76,
                fontWeight: 700,
                color: "#fafafa",
                lineHeight: 1.05,
                letterSpacing: -1.5,
              }}
            >
              {name}
            </div>
            <div
              style={{
                fontSize: 32,
                color: "#a1a1aa",
                lineHeight: 1.3,
              }}
            >
              {line}
            </div>
          </div>

          <div style={{ fontSize: 26, color: "#52525b" }}>
            Coaching on ponglens.com
          </div>
        </div>
      </div>
    ),
    size
  );
}
