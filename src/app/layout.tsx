import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// viewport-fit=cover lets the mobile bottom nav pad for the home indicator
// via env(safe-area-inset-bottom).
export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ponglens.com"),
  title: {
    default: "PongLens · A performance hub for competitive table tennis",
    template: "%s · PongLens",
  },
  description:
    "Upload a match video and get back just the play, every point as its own clip, placement maps, and a running score you can share with your coach.",
  applicationName: "PongLens",
  keywords: [
    "table tennis",
    "ping pong",
    "match analysis",
    "table tennis video analysis",
    "rally editor",
    "shot placement heatmap",
    // Not "spin analysis": nothing surfaces spin, and SPEC.md holds it
    // back until the accuracy earns it. Coach reviews are real and
    // shipped, so they are what this slot should say.
    "table tennis coaching",
    "coach match reviews",
  ],
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    url: "https://www.ponglens.com",
    siteName: "PongLens",
    title: "PongLens · A performance hub for competitive table tennis",
    description:
      "Upload a match video and get back just the play, every point as its own clip, placement maps, and a running score you can share with your coach.",
    images: [
      {
        url: "/img/og.jpg",
        width: 1200,
        height: 630,
        alt: "PongLens. A performance hub for competitive table tennis.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PongLens · A performance hub for competitive table tennis",
    description:
      "Upload a match video and get back just the play, every point as its own clip, placement maps, and a running score you can share with your coach.",
    images: ["/img/og.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-cyan-glow focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
        >
          Skip to content
        </a>
        <div id="content" className="flex min-h-screen flex-col">
          {children}
        </div>
        <Analytics />
      </body>
    </html>
  );
}
