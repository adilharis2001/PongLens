"use client";

// Local capture fixture only. The capture driver supplies demo records at the
// network boundary; the layout and components below are the shipped app.
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { StudentView } from "@/app/coaching/students/[id]/StudentView";
import { LessonVideoView } from "@/app/lesson-video/[id]/LessonVideoView";
import { LessonCard } from "@/app/journal/LessonCard";
import type { Lesson } from "@/lib/types";

const coachId = "07601580-0ce3-4a4f-82b0-10ea04cac180";
const student = { id: "0a5e0004-0000-4000-8000-000000000001", coach_id: coachId, player_id: "6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4", display_name: "John Miller", created_at: "2026-09-01T12:00:00Z", archived_at: null };
const summary: Lesson = {
  id: "0a5e0005-0000-4000-8000-000000000001", user_id: coachId, match_id: null,
  kind: "lesson", status: "ready", created_at: "2026-09-09T12:00:00Z",
  transcript: "Keep the backhand block short. Contact the ball in front, then recover. When the next ball comes long, make the first attack forward rather than lifting straight up.",
  takeaways: { title: "Backhand block and first attack", themes: [
    { name: "Backhand block", points: ["Keep the movement short and contact the ball in front.", "Recover your ready position after each block."] },
    { name: "First attack", points: ["Move towards the long ball and play forward.", "Finish balanced so you can play the next ball."] },
  ] }, coach_name: "Miguel Santos",
};
const noAction = () => { throw new Error("Capture fixture is read-only"); };

function Capture() {
  const mode = useSearchParams().get("screen");
  return <>
    <AppNav avatarUrl={null} remembered="coach" />
    <main className="bg-arena flex-1 pb-32 md:pb-16">
      <div className="page-enter mx-auto w-full max-w-4xl px-5 pt-8 sm:px-6 md:pt-12">
        {mode === "recap" ? <LessonVideoView id="0a5e0006-0000-4000-8000-000000000001" up={{ href: "/coaching/students/" + student.id, label: "John Miller" }} />
          : mode === "summary" ? <>
            <h1 className="mb-6 text-2xl font-bold tracking-tight sm:text-3xl">Journal</h1>
            <ul className="list-none"><LessonCard lesson={summary} tags={[]} vocab={[]} onToggleTag={noAction} onCreateTag={noAction} onAddCue={async () => { noAction(); return "error"; }} onUpdated={noAction} onDeleted={noAction} onEdit={noAction} /></ul>
          </> : <StudentView userId={coachId} initialStudent={student} offlineStudents={[]} />}
      </div>
    </main>
  </>;
}
export default function Fixture() { return <Suspense><Capture /></Suspense>; }
