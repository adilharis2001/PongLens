"use client";

import { reviewDotText, type ResearchHumanLabel } from "@/lib/research/labeling";
import type { ResearchProposal } from "@/lib/research/types";

const ORIGIN_COLOR = {
  audio: "#f59e0b",
  blurball: "#22d3ee",
  both: "#4ade80",
  manual: "#e879f9",
} as const;

export function FusedTimeline({
  proposal,
  humanLabel,
  selectedEventId,
  currentTime,
  onSelect,
}: {
  proposal: ResearchProposal;
  humanLabel: ResearchHumanLabel;
  selectedEventId: string | null;
  currentTime: number;
  onSelect: (eventId: string) => void;
}) {
  const duration = Math.max(proposal.video.duration_s, 0.1);
  const x = (time: number) => 28 + (Math.max(0, Math.min(duration, time)) / duration) * 944;
  const waveform = proposal.audio.waveform;
  const stride = Math.max(1, Math.ceil(waveform.length / 700));
  const waveformPath = waveform
    .filter((_, index) => index % stride === 0)
    .map((value, index, shown) => {
      const px = 28 + (index / Math.max(1, shown.length - 1)) * 944;
      const py = 62 - value * 35;
      return `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="rounded-2xl border border-edge bg-[#071323] p-3">
      <div className="mb-2 grid gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 sm:grid-cols-3">
        <span>Top ticks · audio proposals</span>
        <span>Middle dots · BlurBall proposals</span>
        <span>Bottom dots · your review queue</span>
      </div>
      <svg
        viewBox="0 0 1000 250"
        className="w-full"
        role="img"
        aria-label="Synchronized waveform and fused evidence timeline"
      >
        <path d={waveformPath} fill="none" stroke="#334155" strokeWidth="1.5" />
        <line x1="28" x2="972" y1="72" y2="72" stroke="#1e3a4a" />
        <line x1="28" x2="972" y1="139" y2="139" stroke="#1e3a4a" />
        <line x1="28" x2="972" y1="211" y2="211" stroke="#1e3a4a" />
        <text x="30" y="20" fill="#94a3b8" fontSize="11">AUDIO</text>
        <text x="30" y="104" fill="#94a3b8" fontSize="11">BLURBALL</text>
        <text x="30" y="178" fill="#94a3b8" fontSize="11">REVIEW</text>

        {proposal.audio.candidates.map((candidate) => (
          <line
            key={candidate.id}
            x1={x(candidate.time_s)}
            x2={x(candidate.time_s)}
            y1="38"
            y2="72"
            stroke="#f59e0b"
            strokeWidth="2"
          />
        ))}
        {proposal.visual_candidates.map((candidate) => (
          <circle
            key={candidate.id}
            cx={x(candidate.time_s)}
            cy="139"
            r="4.5"
            fill="#22d3ee"
          />
        ))}
        {humanLabel.events.map((event) => {
          const saved = reviewDotText(event.event_type);
          const selected = selectedEventId === event.event_id;
          return (
            <g
              key={event.event_id}
              role="button"
              tabIndex={0}
              aria-label={`${saved.title} at ${event.time_s.toFixed(3)} seconds`}
              onClick={() => onSelect(event.event_id)}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                  keyEvent.preventDefault();
                  onSelect(event.event_id);
                }
              }}
              className="cursor-pointer"
            >
              <circle
                cx={x(event.time_s)}
                cy="211"
                r={selected ? 9 : 7}
                fill={ORIGIN_COLOR[event.origin]}
                stroke={event.event_type ? "#4ade80" : selected ? "#fff" : "#0f172a"}
                strokeWidth={event.event_type ? 4 : selected ? 3 : 2}
              />
              {saved.letter && (
                <text
                  x={x(event.time_s)}
                  y="214.5"
                  textAnchor="middle"
                  fill="#071323"
                  fontSize="8"
                  fontWeight="800"
                >
                  {saved.letter}
                </text>
              )}
            </g>
          );
        })}

        {humanLabel.point.decisive_c_s !== null && (
          <line
            x1={x(humanLabel.point.decisive_c_s)}
            x2={x(humanLabel.point.decisive_c_s)}
            y1="24"
            y2="230"
            stroke="#fb7185"
            strokeWidth="3"
          />
        )}
        <line
          x1={x(currentTime)}
          x2={x(currentTime)}
          y1="20"
          y2="232"
          stroke="#f8fafc"
          strokeWidth="1.5"
        />
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Audio only</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-cyan-glow" />BlurBall only</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-green-400" />Both agree on time</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-magenta-glow" />Manually inserted</span>
        <span><i className="mr-1 inline-block h-3 w-0.5 bg-rose-400" />C · point decided</span>
        <span><i className="mr-1 inline-block h-3 w-3 rounded-full border-[3px] border-green-400" />Reviewed dot</span>
      </div>
    </div>
  );
}
