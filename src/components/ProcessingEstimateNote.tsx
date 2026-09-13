"use client";

import { useEffect, useState } from "react";
import { formatProcessingEstimate } from "@/lib/processingEstimate";

/** Reuses the shipped processing card's body text, with no extra container. */
export function ProcessingEstimateNote({ estimate, jobStatus, serviceState, compact = false, className = "mt-3" }: {
  estimate: unknown; jobStatus: string | null; serviceState: string | undefined; compact?: boolean; className?: string;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const note = formatProcessingEstimate(estimate, { jobStatus, serviceState, now });
  if (!note) return null;
  return <div className={className}>
    <p className={compact ? "text-xs text-zinc-400" : "text-sm text-zinc-300"}>{note.summary}</p>
    {!compact && <p className="mt-1 text-sm text-zinc-500">{note.detail}</p>}
  </div>;
}
