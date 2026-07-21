import type { MetadataRoute } from "next";

// Allow every crawler — search engines and AI/LLM agents (GPTBot, ClaudeBot,
// PerplexityBot, Google-Extended, etc.) — since we want the marketing pages
// discoverable and quotable. Only the authenticated app and auth callback are
// kept out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/auth/"],
      },
    ],
    sitemap: "https://www.ponglens.com/sitemap.xml",
    host: "https://www.ponglens.com",
  };
}
