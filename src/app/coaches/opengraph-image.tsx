import { PREVIEW_SIZE, renderPreview } from "@/lib/marketing/previewCard";

export const alt = "PongLens for coaches. A coaching hub for table tennis, built around every student.";
export const size = PREVIEW_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderPreview({
    title: "A coaching hub for",
    accent: "table tennis.",
    line: "Students, lesson notes, match feedback and video recaps, together in one place.",
    phone: "showcase/coach-students-m.jpg",
  });
}
