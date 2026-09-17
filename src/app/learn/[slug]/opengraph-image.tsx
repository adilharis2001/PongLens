import { PREVIEW_SIZE, renderPreview } from "@/lib/marketing/previewCard";
import { guideBySlugForPlatform } from "../catalog";

export const alt = "A PongLens guide";
export const size = PREVIEW_SIZE;
export const contentType = "image/png";

/** A guide shared as a link shows its own title, not the home page's. */
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = guideBySlugForPlatform(slug, "web");
  return renderPreview({
    title: guide?.title ?? "Learn",
    accent: "A PongLens guide.",
    line: guide?.summary ?? "Guides to every part of PongLens.",
    phone: "showcase/anton-point-m.jpg",
  });
}
