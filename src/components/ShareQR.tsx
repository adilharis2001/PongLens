"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

/**
 * A "Show QR" control beside a share link. Tapping reveals the link's QR
 * inline, on a light rounded panel so a phone camera reads it reliably —
 * for handing a match or coach invite to someone in person. Fully offline:
 * qrcode.react renders the code as inline SVG, no network request.
 */
export function ShareQR({ url }: { url: string }) {
  const [shown, setShown] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setShown((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-glow transition-colors hover:text-white"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3M8 8h2v2H8V8Zm6 6h2v2h-2v-2Zm0-6h2v2h-2V8ZM8 14h2v2H8v-2Z"
          />
        </svg>
        {shown ? "Hide QR" : "Show QR"}
      </button>

      {shown && (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-edge bg-white p-4">
          <QRCodeSVG
            value={url}
            size={160}
            level="M"
            marginSize={2}
            bgColor="#ffffff"
            fgColor="#0a0a12"
          />
          <p className="text-xs font-medium text-zinc-600">Scan to open</p>
        </div>
      )}
    </div>
  );
}
