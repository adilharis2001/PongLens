import type { PlacementLifecycleView } from "@/lib/placement/placementRetry";

interface PlacementStatusCardProps {
  view: PlacementLifecycleView;
  hasDrawablePlacement: boolean;
}

function toneClasses(tone: PlacementLifecycleView["tone"]) {
  if (tone === "warning") {
    return "border-amber-400/30 bg-amber-400/10";
  }
  if (tone === "progress") {
    return "border-cyan-glow/30 bg-cyan-glow/10";
  }
  return "border-edge bg-surface-2/40";
}

export function PlacementStatusCard({
  view,
  hasDrawablePlacement,
}: PlacementStatusCardProps) {
  if (hasDrawablePlacement || view.noticeBody === null) return null;

  return (
    <section
      aria-label="Placement status"
      className={`mb-4 rounded-xl border p-4 ${toneClasses(view.tone)}`}
    >
      <div className="flex items-start gap-3">
        {view.tone === "progress" && (
          <span
            aria-hidden="true"
            className="mt-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-glow/30 border-t-cyan-glow"
          />
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">
            {view.noticeTitle ?? view.sheetTitle}
          </h3>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            {view.noticeBody}
          </p>
        </div>
      </div>
    </section>
  );
}
