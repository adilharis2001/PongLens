import type {
  Guide,
  GuideSection,
  LearnAudience,
  LearnPlatform,
  LearnVisibility,
  NumberedTutorialChapter,
  TutorialChapter,
} from "./catalogTypes.ts";
import { coachGuides, COACH_GROUPS } from "./coachGuides.ts";
import { playerGuides, PLAYER_GROUPS } from "./playerGuides.ts";
import { tutorialChapters } from "./tutorialChapters.ts";

export const guides: Guide[] = [...playerGuides, ...coachGuides];
export const chapters: TutorialChapter[] = tutorialChapters;
export const LEARN_GROUPS: Record<LearnAudience, readonly string[]> = {
  player: PLAYER_GROUPS,
  coach: COACH_GROUPS,
};

function isVisible(
  visibility: LearnVisibility,
  audience: LearnAudience,
  platform: LearnPlatform,
): boolean {
  return (
    visibility.audiences.includes(audience) && visibility.platforms.includes(platform)
  );
}

function visibleSections(
  sections: GuideSection[],
  guideVisibility: LearnVisibility,
  audience: LearnAudience,
  platform: LearnPlatform,
): GuideSection[] {
  return sections.filter((section) =>
    isVisible(section.visibility ?? guideVisibility, audience, platform),
  );
}

export function visibleGuides(audience: LearnAudience, platform: LearnPlatform): Guide[] {
  return guides
    .filter((guide) => isVisible(guide.visibility, audience, platform))
    .map((guide) => ({
      ...guide,
      sections: visibleSections(guide.sections, guide.visibility, audience, platform),
    }));
}

export function visibleChapters(
  audience: LearnAudience,
  platform: LearnPlatform,
): NumberedTutorialChapter[] {
  return chapters
    .filter((chapter) => isVisible(chapter.visibility, audience, platform))
    .map((chapter, index) => ({ ...chapter, n: index + 1 }));
}

export function visibleGroups(audience: LearnAudience, platform: LearnPlatform): string[] {
  const groupsWithGuides = new Set(visibleGuides(audience, platform).map((guide) => guide.group));
  return LEARN_GROUPS[audience].filter((group) => groupsWithGuides.has(group));
}

export function guideBySlug(
  slug: string,
  audience: LearnAudience,
  platform: LearnPlatform,
): Guide | undefined {
  return visibleGuides(audience, platform).find((guide) => guide.slug === slug);
}

export function guideBySlugForPlatform(
  slug: string,
  platform: LearnPlatform,
): Guide | undefined {
  return (Object.keys(LEARN_GROUPS) as LearnAudience[])
    .map((audience) => guideBySlug(slug, audience, platform))
    .find((guide): guide is Guide => guide !== undefined);
}

export function visibleRelatedGuides(
  guide: Guide,
  audience: LearnAudience,
  platform: LearnPlatform,
): Guide[] {
  return (guide.related ?? [])
    .map((slug) => guideBySlug(slug, audience, platform))
    .filter((related): related is Guide => related !== undefined);
}

/** Flat searchable text per guide, for the index's filter. */
export function guideSearchText(guide: Guide): string {
  const parts: string[] = [guide.title, guide.summary];
  for (const section of guide.sections) {
    if (section.heading) parts.push(section.heading);
    if (section.steps) parts.push(...section.steps);
    if (section.paragraphs) parts.push(...section.paragraphs);
    if (section.bullets) parts.push(...section.bullets);
    if (section.tip) parts.push(section.tip);
  }
  return parts.join(" ").toLowerCase();
}

/** The first sentence-sized snippet containing the query. */
export function guideSnippet(guide: Guide, query: string): string | null {
  const q = query.toLowerCase();
  const texts: string[] = [];
  for (const section of guide.sections) {
    if (section.heading) texts.push(section.heading);
    if (section.steps) texts.push(...section.steps);
    if (section.paragraphs) texts.push(...section.paragraphs);
    if (section.bullets) texts.push(...section.bullets);
    if (section.tip) texts.push(section.tip);
  }
  for (const candidate of texts) {
    const index = candidate.toLowerCase().indexOf(q);
    if (index === -1) continue;
    if (candidate.length <= 150) return candidate;
    const start = Math.max(0, index - 40);
    const cut = candidate.slice(start, start + 150);
    return `${start > 0 ? "…" : ""}${cut}…`;
  }
  return null;
}

export function tutorialTotalSeconds(audience: LearnAudience, platform: LearnPlatform): number {
  return visibleChapters(audience, platform).reduce((total, chapter) => total + chapter.seconds, 0);
}

function visibilityErrors(
  label: string,
  visibility: LearnVisibility,
): string[] {
  const errors: string[] = [];
  if (visibility.audiences.length === 0) {
    errors.push(`${label}: visibility audiences must not be empty`);
  }
  if (visibility.platforms.length === 0) {
    errors.push(`${label}: visibility platforms must not be empty`);
  }
  return errors;
}

function sharesVisibility(left: LearnVisibility, right: LearnVisibility): boolean {
  return left.audiences.some(
    (audience) =>
      right.audiences.includes(audience) &&
      left.platforms.some((platform) => right.platforms.includes(platform)),
  );
}

export function validateLearnCatalog(
  input: {
    guides: Guide[];
    chapters: TutorialChapter[];
    groups: Record<LearnAudience, readonly string[]>;
  } = { guides, chapters, groups: LEARN_GROUPS },
): string[] {
  const errors: string[] = [];
  const guideSlugs = new Set<string>();
  const guidesBySlug = new Map<string, Guide>();

  for (const guide of input.guides) {
    if (guideSlugs.has(guide.slug)) {
      errors.push(`guide ${guide.slug}: duplicate guide slug`);
    } else {
      guideSlugs.add(guide.slug);
      guidesBySlug.set(guide.slug, guide);
    }
  }

  for (const guide of input.guides) {
    const label = `guide ${guide.slug}`;
    errors.push(...visibilityErrors(label, guide.visibility));
    for (const audience of guide.visibility.audiences) {
      if (!input.groups[audience].includes(guide.group)) {
        errors.push(`${label}: unknown group ${guide.group} for ${audience}`);
      }
    }
    for (const section of guide.sections) {
      if (section.visibility) errors.push(...visibilityErrors(label, section.visibility));
    }
    for (const relatedSlug of guide.related ?? []) {
      const related = guidesBySlug.get(relatedSlug);
      if (!related) {
        errors.push(`guide ${guide.slug}: related guide ${relatedSlug} does not exist`);
      } else if (!sharesVisibility(guide.visibility, related.visibility)) {
        errors.push(`guide ${guide.slug}: related guide ${relatedSlug} has no shared visibility`);
      }
    }
  }

  const chapterSlugs = new Map<LearnAudience, Set<string>>();
  for (const audience of Object.keys(input.groups) as LearnAudience[]) {
    chapterSlugs.set(audience, new Set());
  }
  for (const chapter of input.chapters) {
    const label = `chapter ${chapter.slug}`;
    errors.push(...visibilityErrors(label, chapter.visibility));
    for (const audience of chapter.visibility.audiences) {
      const slugs = chapterSlugs.get(audience) ?? new Set<string>();
      if (slugs.has(chapter.slug)) {
        errors.push(`${label}: duplicate chapter slug for ${audience}`);
      }
      slugs.add(chapter.slug);
      chapterSlugs.set(audience, slugs);
    }
    if (chapter.guide) {
      const guide = guidesBySlug.get(chapter.guide);
      if (!guide) {
        errors.push(`${label}: guide ${chapter.guide} does not exist`);
      } else if (!sharesVisibility(chapter.visibility, guide.visibility)) {
        errors.push(`${label}: guide ${chapter.guide} has no shared visibility`);
      }
    }
  }

  return errors;
}
