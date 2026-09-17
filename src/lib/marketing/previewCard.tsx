import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Link previews for the public pages: the page's own headline beside a
 * real phone screen, on the site's ink. Each page's opengraph-image.tsx
 * calls renderPreview with its words, so the card moves with the copy
 * instead of being a JPEG from the month the site launched.
 */

export const PREVIEW_SIZE = { width: 1200, height: 630 };

async function loadFont(): Promise<ArrayBuffer | null> {
  // Geist from Google Fonts, as TrueType: the rasteriser cannot read
  // woff2, and an old-browser user agent is how Google serves TTF. If the
  // fetch fails at build time the card renders in the rasteriser's own
  // fallback face rather than failing the build.
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Geist:wght@700&display=swap",
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:20.0)" } },
    ).then((r) => r.text());
    const url = css.match(/src: url\(([^)]+)\) format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

async function loadPublicImage(file: string): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", file));
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function PreviewCard({
  title,
  accent,
  line,
  phone,
}: {
  title: string;
  accent: string;
  line: string;
  phone: string | null;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#0a0a0f",
        color: "#fafafa",
        fontFamily: "Geist, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -200,
          top: -260,
          width: 900,
          height: 900,
          borderRadius: 900,
          background:
            "radial-gradient(circle, rgba(34,211,238,.18) 0%, rgba(10,10,15,0) 62%)",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 0 72px 72px",
          width: phone ? 760 : 1200,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 40,
              border: "5px solid #22d3ee",
            }}
          />
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700 }}>
            <span>Pong</span>
            <span style={{ color: "#22d3ee" }}>Lens</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 44,
            fontSize: 62,
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: -1.5,
          }}
        >
          <span>{title}</span>
          <span style={{ color: "#22d3ee" }}>{accent}</span>
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 26,
            color: "#a1a1aa",
            lineHeight: 1.4,
          }}
        >
          {line}
        </div>
      </div>
      {phone && (
        <div
          style={{
            position: "absolute",
            right: 84,
            top: 60,
            width: 300,
            height: 650,
            borderRadius: 44,
            border: "10px solid #18181b",
            background: "#0a0a0f",
            overflow: "hidden",
            display: "flex",
            boxShadow: "0 30px 80px rgba(0,0,0,.6)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={phone}
            alt=""
            width={280}
            height={606}
            style={{ width: 280, height: 606 }}
          />
        </div>
      )}
    </div>
  );
}

export async function renderPreview(props: {
  title: string;
  accent: string;
  line: string;
  /** A phone capture under public/, e.g. "showcase/anton-point-m.jpg". */
  phone: string;
}) {
  const [font, phone] = await Promise.all([
    loadFont(),
    loadPublicImage(props.phone),
  ]);
  return new ImageResponse(<PreviewCard {...props} phone={phone} />, {
    ...PREVIEW_SIZE,
    fonts: font
      ? [{ name: "Geist", data: font, weight: 700, style: "normal" }]
      : undefined,
  });
}
