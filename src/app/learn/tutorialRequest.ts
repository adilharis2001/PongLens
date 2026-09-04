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
