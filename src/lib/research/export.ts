interface ResearchExportPayload {
  batch?: {
    slug?: unknown;
  };
}

export function researchExportFilename(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "ponglens-research-export.json";
  }
  const slug = String(
    (payload as ResearchExportPayload).batch?.slug ?? "",
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug ? `${slug}.json` : "ponglens-research-export.json";
}
