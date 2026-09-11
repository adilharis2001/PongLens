"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SectionHeading } from "@/components/SectionHeading";
import { agoLabel } from "./processingView";
import { monitorLabel, outcomeLabel, pipelineLabel, reasonLabel, type ProcessingHealth } from "./processingHealthView";

export function ProcessingHealthView({ doc, unavailable = false }: { doc: ProcessingHealth | null; unavailable?: boolean }) {
  const monitor = doc ? monitorLabel(doc, new Date()) : "Loading";
  return <section className="mt-8" aria-label="Point processing">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <SectionHeading>Point processing</SectionHeading>
      <p className="text-xs text-zinc-500">{unavailable ? "Status unavailable" : monitor}</p>
    </div>
    {unavailable ? <p className="mt-3 text-sm text-zinc-500">Processing details could not be refreshed. The worker may still be running.</p>
      : !doc ? <p className="mt-3 text-sm text-zinc-500">Loading processing details.</p>
      : <>
        {doc.incidents.filter((incident) => !incident.recovered_at).map((incident) =>
          <p key={incident.id} className={`mt-3 text-sm ${incident.kind === "telemetry_missing" ? "text-zinc-400" : "text-amber-300"}`}>
            {incident.kind === "telemetry_missing" ? "Some processing attempts have incomplete records. Their body outcome is unknown."
              : `Point processing encountered problems on ${incident.details.affected_jobs ?? "multiple"} jobs. Check the outcomes below.`}
          </p>)}
        {doc.missing.length > 0 && !doc.incidents.some((i) => i.kind === "telemetry_missing" && !i.recovered_at) &&
          <p className="mt-3 text-sm text-zinc-400">{doc.missing.length} completed matches have no processing record.</p>}
        {doc.runs.length === 0 ? <p className="mt-3 text-sm text-zinc-500">No point-processing attempts have been recorded yet.</p>
          : <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
            {doc.runs.slice(0, 10).map((run) => {
              const problem = run.status === "degraded" || run.status === "failed";
              return <li key={run.attempt_key} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-zinc-100">{outcomeLabel(run.status)}</p>
                  {run.match_id && <Link href={`/admin/uploads/${run.match_id}`} className="inline-flex min-h-11 items-center text-sm text-zinc-400 hover:text-cyan-glow">Open the upload</Link>}
                </div>
                <p className="mt-1.5 text-sm text-zinc-300">Requested: {pipelineLabel(run.requested_pipeline)} · Delivered: {pipelineLabel(run.delivered_pipeline)}</p>
                {run.reason_code && <p className={`mt-1 text-sm ${problem ? "text-amber-300" : "text-zinc-400"}`}>{reasonLabel(run.reason_code)}</p>}
                <p className="mt-1.5 break-words text-xs text-zinc-500" title={run.release_id ?? undefined}>
                  {run.release_id ? `Release ${run.release_id.slice(0, 12)}` : "Unsealed worker"}
                  {run.body_model ? ` · Body model ${run.body_model}` : " · Body model not recorded"}
                  {` · Attempt ${run.attempt_key.split(":").at(-1)}`}
                  {` · ${agoLabel(run.finished_at ?? run.started_at, new Date())}`}
                </p>
              </li>;
            })}
          </ul>}
        {doc.incidents.filter((i) => i.recovered_at).slice(0, 2).map((incident) =>
          <p key={incident.id} className="mt-3 text-xs text-zinc-500">{incident.kind === "telemetry_missing"
            ? "Missing processing records have been received."
            : `Body processing recovered on release ${incident.release_id.slice(0, 12)}.`}</p>)}
      </>}
  </section>;
}

export function ProcessingHealthSection() {
  const [doc, setDoc] = useState<ProcessingHealth | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { data, error } = await createClient().rpc("admin_processing_health")
          .abortSignal(AbortSignal.timeout(8_000));
        if (stopped) return;
        setUnavailable(!!error || !data);
        if (!error && data) setDoc(data as ProcessingHealth);
      } catch {
        if (!stopped) setUnavailable(true);
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return <ProcessingHealthView doc={doc} unavailable={unavailable} />;
}
