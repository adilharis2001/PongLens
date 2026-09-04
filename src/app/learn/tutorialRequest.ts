import { visibleChapters } from "./catalog.ts";
import type {
  LearnAudience,
  LearnPlatform,
  NumberedTutorialChapter,
} from "./catalogTypes.ts";

export interface TutorialRequestInput {
  course: unknown;
  platform: unknown;
  slug?: unknown;
}

export interface TutorialMediaSelection {
  slug: string;
  mediaKey: string;
}

/**
 * The player files shipped before courses were namespaced. Keep this as an
 * explicit release allowlist: adding a future player chapter to the catalog
 * must not make a flat storage key signable by accident.
 */
const LEGACY_PLAYER_TUTORIAL_MEDIA: readonly TutorialMediaSelection[] = [
  { slug: "home", mediaKey: "tutorial/home.mp4" },
  { slug: "upload", mediaKey: "tutorial/upload.mp4" },
  { slug: "viewer", mediaKey: "tutorial/viewer.mp4" },
  { slug: "point", mediaKey: "tutorial/point.mp4" },
  { slug: "keepscore", mediaKey: "tutorial/keepscore.mp4" },
  { slug: "analysis", mediaKey: "tutorial/analysis.mp4" },
  { slug: "export", mediaKey: "tutorial/export.mp4" },
  { slug: "coach", mediaKey: "tutorial/coach.mp4" },
  { slug: "journal", mediaKey: "tutorial/journal.mp4" },
];

function isLearnAudience(value: unknown): value is LearnAudience {
  return value === "player" || value === "coach";
}

function isLearnPlatform(value: unknown): value is LearnPlatform {
  return value === "web" || value === "ios";
}

export function resolveTutorialRequest(
  input: TutorialRequestInput,
): NumberedTutorialChapter[] | null {
  if (!isLearnAudience(input.course) || !isLearnPlatform(input.platform)) {
    return null;
  }

  const chapters = visibleChapters(input.course, input.platform);
  if (input.slug === undefined) return chapters;
  return chapters.filter((chapter) => chapter.slug === input.slug);
}

export function resolveLegacyTutorialRequest(
  slug?: string,
): readonly TutorialMediaSelection[] {
  if (slug === undefined) return LEGACY_PLAYER_TUTORIAL_MEDIA;
  return LEGACY_PLAYER_TUTORIAL_MEDIA.filter((chapter) => chapter.slug === slug);
}
