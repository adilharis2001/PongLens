import { formatClock, retentionPct, type UploadDetail } from "./uploadView";

export function UploadFact({ label, value, detail = null }: { label: string; value: string; detail?: string | null }) {
  return <div className="rounded-2xl border border-edge bg-surface p-4">
    <dt className="text-xs text-zinc-500">{label}</dt>
    <dd className="mt-1 text-base font-medium text-zinc-100">{value}</dd>
    {detail && <p className="mt-0.5 text-xs text-zinc-600">{detail}</p>}
  </div>;
}

/** The same upload facts on diagnosis and issue review; no second calculation. */
export function UploadProcessingFacts({ totals }: { totals: UploadDetail["totals"] }) {
  const retention = retentionPct(totals.src_duration_s, totals.cut_duration_s);
  return <>
    <UploadFact label="Kept" value={retention != null ? `${retention}%` : "—"}
      detail={formatClock(totals.src_duration_s) && formatClock(totals.cut_duration_s) ? `${formatClock(totals.src_duration_s)} → ${formatClock(totals.cut_duration_s)}` : null} />
    <UploadFact label="Cards" value={String(totals.visible)} detail={totals.deleted > 0 ? `${totals.deleted} removed by owner` : null} />
    <UploadFact label="Scored" value={`${totals.scored} of ${totals.visible}`} detail={totals.starred > 0 ? `${totals.starred} starred` : null} />
  </>;
}

export function UploadPlaybackActions({ onOriginal, hasOriginal, loadingOriginal }: {
  onOriginal: () => void; hasOriginal: boolean; loadingOriginal: boolean;
}) {
  const pill = "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-50 sm:w-auto";
  return <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
    <button type="button" onClick={onOriginal} disabled={loadingOriginal || !hasOriginal} className={pill}>{loadingOriginal ? "Loading…" : "Original"}</button>
  </div>;
}
