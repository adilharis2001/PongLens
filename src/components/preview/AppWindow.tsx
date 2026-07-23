import { PointList } from "./PointList";
import { Scorebug } from "./Scorebug";
import { TableScene } from "./TableScene";

/**
 * Stylized app-window mockup of the match player: browser chrome, a "video"
 * area rendered as a neon table scene with the scorebug and a transport bar,
 * and the point-list panel beside it. Clearly a preview, not a screenshot.
 */
export function AppWindow() {
  return (
    <figure className="mx-auto max-w-4xl">
      <div
        className="overflow-hidden rounded-2xl border border-edge bg-surface shadow-2xl shadow-black/60"
        style={{ boxShadow: "0 0 60px rgba(34,211,238,.07), 0 24px 64px rgba(0,0,0,.6)" }}
      >
        {/* browser chrome */}
        <div className="flex items-center gap-3 border-b border-edge bg-surface-2 px-4 py-2.5">
          <span aria-hidden="true" className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
          </span>
          <span className="mx-auto flex min-w-0 items-center gap-1.5 rounded-md border border-edge/70 bg-ink/60 px-3 py-1 font-mono text-[11px] text-zinc-400">
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <span className="truncate">ponglens.com/match/friday-league</span>
          </span>
          {/* spacer to balance the dots so the url pill centers */}
          <span aria-hidden="true" className="w-[52px]" />
        </div>

        {/* app body: player + point list */}
        <div className="grid md:grid-cols-[minmax(0,1fr)_260px]">
          {/* video area */}
          <div className="relative aspect-video" style={{ background: "#0a0a12" }}>
            <TableScene />

            {/* scorebug overlay */}
            <div className="absolute left-3 top-3">
              <Scorebug />
            </div>

            {/* transport bar */}
            <div
              className="absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-6"
              style={{
                background:
                  "linear-gradient(to top, rgba(10,10,15,.85), transparent)",
              }}
            >
              <div className="mb-2 flex gap-1.5" aria-hidden="true">
                {[10, 11, 12, 13, 14].map((n) => (
                  <span
                    key={n}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums ${
                      n === 12
                        ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                        : "border-edge bg-ink/40 text-zinc-400"
                    }`}
                  >
                    {n}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 text-white"
                  fill="currentColor"
                >
                  <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
                </svg>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                  4:08
                </span>
                <span className="relative h-1 min-w-0 flex-1 overflow-visible rounded-full bg-white/15">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-cyan-glow"
                    style={{ width: "36%" }}
                  />
                  <span
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-glow shadow-[0_0_8px_rgba(34,211,238,0.7)]"
                    style={{ left: "36%" }}
                  />
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                  11:32
                </span>
              </div>
            </div>
          </div>

          {/* point list beside (below on mobile) */}
          <div className="border-t border-edge md:border-l md:border-t-0">
            <PointList />
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-zinc-400">
        Product preview · illustrative data
      </figcaption>
    </figure>
  );
}
