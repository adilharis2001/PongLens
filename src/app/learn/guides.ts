export {
  guideSearchText,
  guideSnippet,
  guideBySlugForPlatform,
  tutorialTotalSeconds,
  visibleChapters,
  visibleGroups,
  visibleGuides,
  visibleRelatedGuides,
  validateLearnCatalog,
} from "./catalog.ts";
export type {
  Guide,
  GuideImage,
  GuideSection,
  LearnAudience,
  LearnPlatform,
  LearnVisibility,
  TutorialChapter,
} from "./catalogTypes.ts";

import { guideBySlug as catalogGuideBySlug, visibleGuides } from "./catalog.ts";

export const GROUPS = ["Get started", "Review and score", "Your game", "Share and export"] as const;
export const guides = visibleGuides("player", "web");

/** @deprecated Use the audience-aware catalog lookup. */
export function guideBySlug(slug: string): import("./catalogTypes.ts").Guide | undefined;
export function guideBySlug(
  slug: string,
  audience: import("./catalogTypes.ts").LearnAudience,
  platform: import("./catalogTypes.ts").LearnPlatform,
): import("./catalogTypes.ts").Guide | undefined;
export function guideBySlug(
  slug: string,
  audience?: import("./catalogTypes.ts").LearnAudience,
  platform?: import("./catalogTypes.ts").LearnPlatform,
) {
  return audience && platform
    ? catalogGuideBySlug(slug, audience, platform)
    : guideBySlugForPlatform(slug, "web");
}
