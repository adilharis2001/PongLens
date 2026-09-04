import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { visibleChapters, visibleGuides } from "../src/app/learn/catalog.ts";
import type { Guide, GuideSection, LearnAudience, TutorialChapter } from "../src/app/learn/catalogTypes.ts";

const audiences: LearnAudience[] = ["player", "coach"];
const target = fileURLToPath(
  new URL("../ios/PongLens/PongLens/Resources/learn-catalog.json", import.meta.url),
);

function serializeSection(section: GuideSection): Omit<GuideSection, "images" | "visibility"> {
  const { images: _images, visibility: _visibility, ...serialized } = section;
  return serialized;
}

function serializeGuide(guide: Guide, audience: LearnAudience) {
  const { visibility: _visibility, sections, ...serialized } = guide;
  return {
    audience,
    ...serialized,
    sections: sections.map(serializeSection),
  };
}

function serializeChapter(chapter: TutorialChapter, audience: LearnAudience) {
  const { visibility: _visibility, ...serialized } = chapter;
  return { audience, ...serialized };
}

export function serializeIOSLearnCatalog(): string {
  const guidesByAudience = audiences.map((audience) => ({
    audience,
    guides: visibleGuides(audience, "ios"),
  }));

  const catalog = {
    schemaVersion: 1,
    groups: guidesByAudience.map(({ audience, guides }) => ({
      audience,
      groups: [...new Set(guides.map((guide) => guide.group))],
    })),
    guides: guidesByAudience.flatMap(({ audience, guides }) =>
      guides.map((guide) => serializeGuide(guide, audience)),
    ),
    chapters: audiences.flatMap((audience) =>
      visibleChapters(audience, "ios").map((chapter) => serializeChapter(chapter, audience)),
    ),
  };

  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function run(): void {
  const output = serializeIOSLearnCatalog();
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";

  if (process.argv.includes("--check")) {
    if (existing !== output) process.exitCode = 1;
  } else {
    writeFileSync(target, output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run();
}
