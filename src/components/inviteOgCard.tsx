import { ImageResponse } from "next/og";
import type { InvitePreviewCopy } from "@/lib/coaches/invitePreview";

/**
 * The picture an invite link shows in somebody's messages (169).
 *
 * One card for both directions — a player inviting a coach and a coach
 * inviting a student — because they are the same moment from either end
 * and two cards would drift. The wording is decided in invitePreview.ts;
 * this only draws it.
 *
 * Text only, deliberately. The obvious richer card would carry a match
 * thumbnail, but a preview is fetched by whoever holds the link before
 * anyone has signed in, and footage is not ours to put in front of them.
 * A name and a sentence is the whole invitation anyway.
 */

export const inviteOgSize = { width: 1200, height: 630 };

export function inviteOgCard(copy: InvitePreviewCopy) {
  // A long name wraps rather than shrinking away to nothing; the
  // invitation is the thing being read, so it keeps the room.
  const headlineSize = copy.headline.length > 42 ? 62 : 76;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          backgroundColor: "#0a0a0f",
          backgroundImage:
            "radial-gradient(ellipse 70% 55% at 50% -10%, rgba(34, 211, 238, 0.18), transparent 60%), radial-gradient(ellipse 45% 40% at 88% 20%, rgba(232, 121, 249, 0.10), transparent 60%)",
          fontFamily: "sans-serif",
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

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {copy.eyebrow && (
            <div
              style={{
                display: "flex",
                fontSize: 34,
                fontWeight: 600,
                color: "#22d3ee",
                letterSpacing: -0.5,
              }}
            >
              {copy.eyebrow}
            </div>
          )}
          <div
            style={{
              display: "flex",
              fontSize: headlineSize,
              fontWeight: 700,
              color: "#fafafa",
              lineHeight: 1.08,
              letterSpacing: -1.5,
            }}
          >
            {copy.headline}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              color: "#a1a1aa",
              lineHeight: 1.3,
            }}
          >
            {copy.detail}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 26, color: "#52525b" }}>
          ponglens.com
        </div>
      </div>
    ),
    inviteOgSize,
  );
}
