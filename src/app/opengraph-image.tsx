import { PREVIEW_SIZE, renderPreview } from "@/lib/marketing/previewCard";

export const alt = "PongLens. A performance hub for competitive table tennis.";
export const size = PREVIEW_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderPreview({
    title: "A performance hub for",
    accent: "competitive table tennis.",
    line: "Film a match. Get every point as a clip, with analysis, highlights and a place for your coach.",
    phone: "showcase/anton-point-m.jpg",
  });
}
