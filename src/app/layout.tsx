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
    default: "PongLens — Your table tennis matches, decoded",
    template: "%s · PongLens",
  },
  description:
    "Upload a table tennis match video and get back a cut of pure play. Placement maps, spin fingerprints, and match reports are coming.",
  openGraph: {
    title: "PongLens — Your table tennis matches, decoded",
    description:
      "Upload a match video, get back the rallies that matter. AI-powered table tennis analysis.",
    url: "https://ponglens.com",
    siteName: "PongLens",
    images: ["/img/hero.jpg"],
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
