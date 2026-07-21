import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ponglens.com"),
  title: {
    default: "PongLens · Match analysis for table tennis",
    template: "%s · PongLens",
  },
  description:
    "PongLens turns table tennis match videos into something you can study. Pure play cuts today. Placement and spin analysis next.",
  openGraph: {
    type: "website",
    url: "https://ponglens.com",
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
      {
        url: "/img/og-square.png",
        width: 800,
        height: 800,
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
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
