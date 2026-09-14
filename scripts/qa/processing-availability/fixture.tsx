import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { RawMatchView } from "@/app/match/[id]/RawMatchView";
import { HomeOverview } from "@/app/dashboard/HomeOverview";
import { UploadCard } from "@/app/dashboard/UploadCard";
import { YouTubeImport } from "@/components/YouTubeImport";
import { MatchLibrary } from "@/app/matches/MatchLibrary";
import { ProcessingSection } from "@/app/admin/processing/ProcessingSection";
import { ReelRow } from "@/app/match/[id]/ReelBar";
import { MatchView } from "@/app/match/[id]/MatchView";
import { ProcessingAvailabilityNotice } from "@/components/ProcessingAvailabilityNotice";
import { fixture, match, job, owner, matchId, jobId } from "./fixture-client";
import type { Match, Point } from "@/lib/types";
import { finishPreviewUpload } from "./fixture-upload";

// Deny real actions in this isolated preview, including API calls from imported screens.
window.fetch = async (input, init) => {
  // A synthetic queued response exercises the actual import form without submitting a URL.
  if (input === "/api/import-url") return new Response(JSON.stringify({ jobId, options: { points: true, auto_process: true, placement: false } }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (input === "/api/upload-url") {
    const request = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify(request.action === "complete" ? { matchId } : { bucket: "preview", key: "preview.mp4", uploadId: "preview", parts: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (input === "/api/process") return new Response(JSON.stringify({ job_id: jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ error: "Preview only", data: [], url: null }), { status: 400, headers: { "Content-Type": "application/json" } });
};

function Preview() {
  const [screen, setScreen] = useState("match");
  const [revision, setRevision] = useState(0);
  function update(key: keyof typeof fixture, value: string) { fixture[key] = value; setRevision((n) => n + 1); }
  return <>
    <aside className="border-b border-edge p-3 text-sm" aria-label="Preview controls">
      <label>Screen <select value={screen} onChange={(e) => setScreen(e.target.value)}>{["match", "home", "library", "admin", "upload", "import", "clip", "uploading", "exports"].map((s) => <option key={s}>{s}</option>)}</select></label>{" "}
      {(["main", "fast", "hand"] as const).map((lane) => <label key={lane}>{lane} <select aria-label={`${lane} status`} value={fixture[lane]} onChange={(e) => update(lane, e.target.value)}>{["available", "unavailable", "maintenance", "unknown"].map((s) => <option key={s}>{s}</option>)}</select>{" "}</label>)}
      <label>Job <select value={fixture.kind} onChange={(e) => update("kind", e.target.value)}>{["deadspace_cut", "hand_cut", "content_check", "youtube_import"].map((s) => <option key={s}>{s}</option>)}</select></label>{" "}
      <label>Match <select value={fixture.matchStatus} onChange={(e) => { update("jobStatus", e.target.value === "uploaded" ? "done" : "queued"); update("matchStatus", e.target.value); }}>{["processing", "uploaded"].map((s) => <option key={s}>{s}</option>)}</select></label>
      {" "}<label>Estimate <select value={fixture.estimate} onChange={(e) => update("estimate", e.target.value)}>{["range", "queue_only", "unknown", "overdue", "stale"].map((s) => <option key={s}>{s}</option>)}</select></label>
      {screen === "upload" && <button className="ml-3 underline" onClick={() => void finishPreviewUpload()}>Finish simulated upload</button>}
    </aside>
    <main key={`${screen}-${revision}`} className="mx-auto max-w-3xl px-4 py-6 sm:px-6" aria-label="Application preview">
      {screen === "match" ? <RawMatchView match={match() as unknown as Match} rawUrl={null} isOwner commerceEnabled minutesBalance={300} initialJob={job()} handCutEnabled initialNotes={[]} noteAuthors={[]} userId={owner} />
        : screen === "home" ? <HomeOverview userId={owner} accountName="Player" firstStepsDismissed />
          : screen === "library" ? <MatchLibrary userId={owner} accountName="Player" />
          : screen === "admin" ? <ProcessingSection />
          : screen === "clip" ? <MatchView match={{ ...match(), status: "ready" } as unknown as Match} initialPoints={[]} initialNotes={[]} userId={owner} accountName="Player" ownerName={null} strictness="normal" noteAuthors={[]} initialTags={[]} initialPointTags={[]} />
          : screen === "upload" ? <UploadCard userId={owner} commerceEnabled />
            : screen === "import" ? <YouTubeImport userId={owner} commerceEnabled />
              : <section className="rounded-2xl border border-edge bg-surface p-5">
                {screen === "exports" ? <ReelRow matchId={matchId} visiblePoints={[{ id: "44444444-4444-4444-8444-444444444444", idx: 1, t0: 1, t1: 10, cut_t0: 0, clip_path: "fixture.mp4", starred: true } as Point]} canScore />
                  : <ProcessingAvailabilityNotice state={fixture.main} context={screen === "uploading" ? "uploading" : "export"} className="" />}
              </section>}
    </main>
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
