import type { MetadataRoute } from "next";

import { visibleGuides } from "./learn/catalog";
import { COACH_WALKTHROUGH } from "@/lib/coachWalkthrough";
import { WALKTHROUGH } from "@/lib/walkthrough";

const BASE = "https://www.ponglens.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  // Every public guide, player and coach. The guides are the only long-form
  // writing on the site, so they are most of what search has to work with.
  const guides = (["player", "coach"] as const).flatMap((audience) =>
    visibleGuides(audience, "web").map((guide) => ({
      url: `${BASE}/learn/${guide.slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  );

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
            "A walkthrough of PongLens: upload a table tennis match from your phone, get it back with the dead time between points removed, score it in about ten minutes, and read what the match says about your game.",
          content_loc: `${BASE}/demo/walkthrough-desktop.mp4`,
          duration: WALKTHROUGH.durationSeconds,
          publication_date: WALKTHROUGH.uploaded,
          family_friendly: "yes",
          live: "no",
        },
      ],
    },
    {
      url: `${BASE}/coaches`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
      videos: [
        {
          title: "How coaching works on PongLens",
          thumbnail_loc: `${BASE}/demo/coach-desktop.jpg`,
          description:
            "A walkthrough of the PongLens coaching workspace: a coach profile, a page per student, lesson recording, shared journals, review orders, delivery and payouts.",
          content_loc: `${BASE}/demo/coach-desktop.mp4`,
          duration: COACH_WALKTHROUGH.durationSeconds,
          publication_date: COACH_WALKTHROUGH.uploaded,
          family_friendly: "yes",
          live: "no",
        },
      ],
    },
    {
      url: `${BASE}/learn`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    ...guides,
    {
      url: `${BASE}/roadmap`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.5,
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
