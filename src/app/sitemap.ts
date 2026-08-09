import type { MetadataRoute } from "next";

import { WALKTHROUGH } from "@/lib/walkthrough";

const BASE = "https://www.ponglens.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: `${BASE}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
      // The walkthrough, declared where crawlers look for video. The page
      // already carries VideoObject markup; this is the other half — a
      // video sitemap entry is what gets it discovered rather than merely
      // understood once found.
      videos: [
        {
          title: "How PongLens works",
          thumbnail_loc: `${BASE}/demo/walkthrough-desktop.jpg`,
          description:
            "A walkthrough of PongLens: upload a table tennis match from your phone or YouTube, get it back with the dead time between points removed, score it in about ten minutes, and read what the match says about your game.",
          content_loc: `${BASE}/demo/walkthrough-desktop.mp4`,
          duration: WALKTHROUGH.durationSeconds,
          publication_date: WALKTHROUGH.uploaded,
          family_friendly: "yes",
          live: "no",
        },
      ],
    },
    {
      url: `${BASE}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
