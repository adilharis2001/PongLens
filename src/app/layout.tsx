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
    default: "PongLens · Match analysis for table tennis",
    template: "%s · PongLens",
  },
  description:
    "PongLens turns table tennis match videos into something you can study. Pure play cuts today. Placement and spin analysis next.",
  applicationName: "PongLens",
  keywords: [
    "table tennis",
    "ping pong",
    "match analysis",
    "table tennis video analysis",
    "rally editor",
    "shot placement heatmap",
    "spin analysis",
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
    title: "PongLens · Match analysis for table tennis",
    description:
      "PongLens turns table tennis match videos into something you can study. Pure play cuts today. Placement and spin analysis next.",
    images: [
      {
        url: "/img/og.png",
        width: 1200,
        height: 630,
        alt: "PongLens. Match analysis for table tennis players.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PongLens · Match analysis for table tennis",
    description:
      "PongLens turns table tennis match videos into something you can study. Pure play cuts today. Placement and spin analysis next.",
    images: ["/img/og.png"],
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
      <body className="flex min-h-full flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
