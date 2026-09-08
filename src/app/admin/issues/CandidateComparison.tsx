"use client";

import { useEffect, useRef, useState } from "react";
import { ClipPlayer } from "@/app/match/[id]/ClipPlayer";
import { whenLabel } from "../uploads/uploadView";
import { versionFacts, type ProcessingVersion } from "./issuesView";

const secondary = "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-50 sm:w-auto";
const effectLabels: Record<string,string> = { scores:"scores", edits:"edited cards", stars:"starred cards", notes:"notes", tags:"tags", share_links:"point share links", coach_findings:"coach findings", drawings:"drawings", reels:"reels" };

/** One player survives source switches and canonical refreshes. Signing is
 * cached per artifact, while the existing player's controls pause a switch. */
export function CandidateComparison({ matchId, current, candidate, sourceAvailable }: { matchId: string; current: ProcessingVersion | null; candidate: ProcessingVersion | null; sourceAvailable: boolean }) {
  const [selection, setSelection] = useState<"current" | "candidate" | "original">("current");
  const [retry, setRetry] = useState(0);
  const [media, setMedia] = useState<{ key: string; url: string } | null>(null);
  const signed = useRef(new Map<string, { key: string; url: string; expiresAt: number }>());
  const playRef = useRef<{play:()=>void;pause:()=>void} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidateId = candidate?.id;
  const activeSelection = selection === "candidate" && !candidateId ? "current" : selection;
  const original = activeSelection === "original";
  const selected = activeSelection === "candidate" ? candidate : current;
  const selectedId = original ? undefined : selected?.id;
  const mediaKey = original ? `${matchId}:original` : `${selectedId ?? ""}:${selected?.cut_path ?? ""}`;
  const playable = original ? sourceAvailable : !!selected?.cut_path;
  useEffect(() => {
    if (selection === "candidate" && !candidateId) setSelection("current");
  }, [candidateId, selection]);
  function selectVersion(next: typeof selection) {
    if (next === activeSelection) return;
    playRef.current?.pause();
    setSelection(next);
  }
  useEffect(() => {
    const controller = new AbortController();
    playRef.current?.pause();
    setError(null);
    if (!playable) return () => controller.abort();
    const cached = signed.current.get(mediaKey);
    if (cached && cached.expiresAt > Date.now()) {
      setMedia(cached);
      return () => controller.abort();
    }
    void (async () => {
      try {
        const response = await fetch("/api/admin/media-url", { method:"POST", headers:{"Content-Type":"application/json"}, signal:controller.signal,
          body:JSON.stringify(original ? {matchId,raw:true} : {matchId,versionId:selectedId}) });
        const result = await response.json();
        if (!response.ok || !result.url) throw new Error("media unavailable");
        if (!controller.signal.aborted) {
          const next = {key:mediaKey,url:result.url,expiresAt:Date.now()+55*60*1000};
          signed.current.set(mediaKey,next);
          setMedia(next);
        }
      } catch { if (!controller.signal.aborted) setError("Could not load the video. Try again."); }
    })();
    return () => controller.abort();
  }, [matchId, mediaKey, playable, retry, selectedId, original]);
  return <>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-full border border-edge p-1" role="group" aria-label="Processing version">
        {[{id:"current" as const,label:"Current"},{id:"candidate" as const,label:"New version"}].map(option => <button key={option.id} type="button" aria-pressed={activeSelection===option.id} disabled={option.id==="candidate" && !candidate} onClick={()=>selectVersion(option.id)} className={`rounded-full px-4 py-2 text-sm transition-colors disabled:opacity-50 ${activeSelection===option.id?"bg-surface-2 text-white":"text-zinc-400 hover:text-white"}`}>{option.label}</button>)}
      </div>
      <button type="button" className={secondary} aria-pressed={original} disabled={!sourceAvailable} onClick={()=>selectVersion("original")}>Original</button>
    </div>
    <div className="mt-4 aspect-video w-full overflow-hidden rounded-2xl bg-ink">
      <div className={media?.key===mediaKey && !error && playable ? "h-full" : "hidden"}>
        {media && <ClipPlayer src={media.url} mode="cut" fill readPixels={false} playRef={playRef} onMediaError={()=>{if(media.key===mediaKey)setError("Could not play the video. Try again.");}} />}
      </div>
      {(media?.key!==mediaKey || error || !playable) && <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">{error || (!playable ? "Video not available." : "Loading video…")}</div>}
    </div>
    {error && <button type="button" className={`${secondary} mt-3`} onClick={()=>{signed.current.delete(mediaKey);setRetry(value=>value+1);}}>Try again</button>}
    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
      {[{label:"Current",version:current},{label:"New version",version:candidate}].map(({label,version}) => {
        if (!version) return null;
        const facts=versionFacts(version);
        return <div key={label}><dt className="text-sm font-medium text-zinc-100">{label}</dt><dd className="mt-2 space-y-1 text-sm text-zinc-400">
          <p>{facts.points} points · {facts.retained} retained</p><p className="break-all">Release: {facts.release}</p><p>Strictness: {facts.strictness} · Placement: {facts.placement}</p>
          <p>Completed: {version.completed_at ? whenLabel(version.completed_at) : "Not recorded"}</p>
        </dd></div>;
      })}
    </dl>
    {current?.effects && <div className="mt-4 text-sm text-zinc-400"><p>Work attached to the current version</p><p className="mt-1">{Object.entries(current.effects).map(([key,count])=>{const label=effectLabels[key] ?? key.replaceAll("_"," ");return `${count} ${count===1?label.replace(/s$/,""):label}`;}).join(" · ")}</p><p className="mt-2">Scores and notes stay with the version where they were created. Publishing keeps the previous version and its work available for restoration.</p></div>}
  </>;
}
