import { readFile } from "node:fs/promises";
import path from "node:path";

import { visibleGuides } from "../learn/catalog";

/**
 * /llms-full.txt: everything /llms.txt says, followed by the full text of
 * every public guide as plain Markdown. Answer engines that read llms.txt
 * follow this convention for the long version, and the guides are the
 * only long-form writing about the product. Generated from the same data
 * the /learn pages render, so it cannot drift from them.
 */
export const dynamic = "force-static";

export async function GET() {
  const short = await readFile(
    path.join(process.cwd(), "public", "llms.txt"),
    "utf8",
  ).catch(() => "# PongLens\n");

  const parts: string[] = [short.trimEnd(), "", "## Guides", ""];
  for (const audience of ["player", "coach"] as const) {
    parts.push(`### ${audience === "player" ? "For players" : "For coaches"}`, "");
    for (const guide of visibleGuides(audience, "web")) {
      parts.push(`#### ${guide.title}`, "", guide.summary, "");
      parts.push(`Read it at https://www.ponglens.com/learn/${guide.slug}`, "");
      for (const section of guide.sections) {
        if (section.heading) parts.push(`##### ${section.heading}`, "");
        section.steps?.forEach((step, i) => parts.push(`${i + 1}. ${step}`));
        if (section.steps?.length) parts.push("");
        section.paragraphs?.forEach((p) => parts.push(p, ""));
        section.bullets?.forEach((b) => parts.push(`- ${b}`));
        if (section.bullets?.length) parts.push("");
        if (section.tip) parts.push(`Good to know: ${section.tip}`, "");
      }
    }
  }

  return new Response(parts.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
