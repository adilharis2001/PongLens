import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { RawMatchView } from "@/app/match/[id]/RawMatchView";
import { HomeOverview } from "@/app/dashboard/HomeOverview";
import { UploadCard } from "@/app/dashboard/UploadCard";
import { YouTubeImport } from "@/components/YouTubeImport";
import { ClipAvailabilityNotice } from "@/components/ClipAvailabilityNotice";
import { ProcessingAvailabilityNotice } from "@/components/ProcessingAvailabilityNotice";
import { fixture, match, job, owner } from "./fixture-client";
import type { Match } from "@/lib/types";

// Deny real actions in this isolated preview, including API calls from imported screens.
window.fetch = async () => new Response(JSON.stringify({ error: "Preview only", data: [], url: null }), { status: 400, headers: { "Content-Type": "application/json" } });

function Preview() {
  const [screen, setScreen] = useState("match");
  const [revision, setRevision] = useState(0);
  function update(key: keyof typeof fixture, value: string) { fixture[key] = value; setRevision((n) => n + 1); }
  return <>
    <aside className="border-b border-edge p-3 text-sm" aria-label="Preview controls">
      <label>Screen <select value={screen} onChange={(e) => setScreen(e.target.value)}>{["match", "home", "upload", "import", "clip", "uploading", "exports"].map((s) => <option key={s}>{s}</option>)}</select></label>{" "}
      {(["main", "fast", "hand"] as const).map((lane) => <label key={lane}>{lane} <select aria-label={`${lane} status`} value={fixture[lane]} onChange={(e) => update(lane, e.target.value)}>{["available", "unavailable", "maintenance", "unknown"].map((s) => <option key={s}>{s}</option>)}</select>{" "}</label>)}
      <label>Job <select value={fixture.kind} onChange={(e) => update("kind", e.target.value)}>{["deadspace_cut", "hand_cut", "content_check", "youtube_import"].map((s) => <option key={s}>{s}</option>)}</select></label>{" "}
      <label>Match <select value={fixture.matchStatus} onChange={(e) => { update("jobStatus", e.target.value === "uploaded" ? "done" : "queued"); update("matchStatus", e.target.value); }}>{["processing", "uploaded"].map((s) => <option key={s}>{s}</option>)}</select></label>
    </aside>
    <main key={`${screen}-${revision}`} className="mx-auto max-w-3xl px-4 py-6 sm:px-6" aria-label="Application preview">
      {screen === "match" ? <RawMatchView match={match() as unknown as Match} rawUrl={null} isOwner commerceEnabled minutesBalance={300} initialJob={job()} handCutEnabled initialNotes={[]} noteAuthors={[]} userId={owner} />
        : screen === "home" ? <HomeOverview userId={owner} accountName="Player" firstStepsDismissed />
          : screen === "upload" ? <UploadCard userId={owner} commerceEnabled />
            : screen === "import" ? <YouTubeImport userId={owner} commerceEnabled />
              : <section className="rounded-2xl border border-edge bg-surface p-5">
                {screen === "clip" ? <><h2>Tools</h2><ClipAvailabilityNotice /></>
                  : <ProcessingAvailabilityNotice state={fixture.main} context={screen === "uploading" ? "uploading" : "export"} className="" />}
              </section>}
    </main>
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
