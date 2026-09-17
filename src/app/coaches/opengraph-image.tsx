import { PREVIEW_SIZE, renderPreview } from "@/lib/marketing/previewCard";

export const alt = "PongLens for table tennis coaches, built around every student.";
export const size = PREVIEW_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderPreview({
    title: "PongLens for table tennis coaches,",
    accent: "built around every student.",
    line: "Students, lesson notes, match feedback and video recaps, together in one place.",
    phone: "showcase/coach-students-m.jpg",
  });
}
