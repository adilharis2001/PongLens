"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draw on a paused frame of the match video (the note sheet's pencil).
 *
 * The frame arrives pre-captured from the on-screen player (see
 * Player.captureFrame). Strokes are stored in frame-normalized
 * coordinates and composited onto the full-resolution frame at save, so
 * what you draw is exactly what the note keeps.
 *
 * Tools: pen and arrow, three ink colors, undo, clear. Save hands back a
 * JPEG blob; the caller uploads it and attaches it to a note.
 */

type Tool = "pen" | "arrow";

// Two inks: both read over any footage, and the toolbar has to fit a
// 375px phone with room left for Save.
const COLORS = [
  { name: "Cyan", value: "#22d3ee" },
  { name: "Magenta", value: "#e879f9" },
];

interface Stroke {
  tool: Tool;
  color: string;
  /** frame-normalized (0-1) points; pen: the path, arrow: [start, end] */
  points: { x: number; y: number }[];
}

/** Longest edge of the saved image. 720p footage passes through as-is. */
const MAX_SAVE_W = 1280;

function drawStroke(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  w: number,
  h: number
) {
  if (s.points.length === 0) return;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = Math.max(2.5, w / 220);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "pen") {
    ctx.beginPath();
    ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x * w, p.y * h);
    ctx.stroke();
  } else {
    const a = s.points[0];
    const b = s.points[s.points.length - 1];
    const ax = a.x * w;
    const ay = a.y * h;
    const bx = b.x * w;
    const by = b.y * h;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 4) return;
    const head = Math.max(10, w / 60);
    const angle = Math.atan2(by - ay, bx - ax);
    // shaft stops where the head begins, so the tip stays sharp
    const sx = bx - Math.cos(angle) * head * 0.6;
    const sy = by - Math.sin(angle) * head * 0.6;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(
      bx - head * Math.cos(angle - Math.PI / 7),
      by - head * Math.sin(angle - Math.PI / 7)
    );
    ctx.lineTo(
      bx - head * Math.cos(angle + Math.PI / 7),
      by - head * Math.sin(angle + Math.PI / 7)
    );
    ctx.closePath();
    ctx.fill();
  }
}

export function Annotator({
  frame,
  onCancel,
  onSave,
}: {
  /** The paused frame, captured by the caller from the ON-SCREEN video.
   *  WebKit (every iPhone browser) black-frames drawImage from hidden
   *  never-presented videos — see the bug list in Player.captureFrame —
   *  so the frame comes from the element that is provably painting it. */
  frame: HTMLCanvasElement;
  onCancel: () => void;
  /** Receives the composited JPEG; resolves when the caller is done
   *  (upload). A rejection re-enables Save. */
  onSave: (blob: Blob) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0].value);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const liveStroke = useRef<Stroke | null>(null);

  // ---- render frame + strokes to the display canvas ----------------------
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const area = areaRef.current;
    if (!canvas || !area) return;
    // object-contain fit of the frame inside the drawing area
    const ar = frame.width / frame.height;
    const aw = area.clientWidth;
    const ah = area.clientHeight;
    const w = Math.min(aw, ah * ar);
    const h = w / ar;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(ctx, s, canvas.width, canvas.height);
    if (liveStroke.current) {
      drawStroke(ctx, liveStroke.current, canvas.width, canvas.height);
    }
  }, [frame, strokes]);

  useEffect(() => {
    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

  // ---- drawing gestures --------------------------------------------------
  const normPoint = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (saving) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events can carry inactive pointer ids; capture is a
      // nicety (keeps strokes alive past the edge), not a requirement
    }
    liveStroke.current = { tool, color, points: [normPoint(e)] };
    redraw();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = liveStroke.current;
    if (!s) return;
    const p = normPoint(e);
    if (s.tool === "arrow") s.points = [s.points[0], p];
    else s.points.push(p);
    redraw();
  };
  const onPointerUp = () => {
    const s = liveStroke.current;
    liveStroke.current = null;
    if (s && s.points.length > 1) setStrokes((all) => [...all, s]);
    else redraw();
  };

  // ---- save --------------------------------------------------------------
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const c = document.createElement("canvas");
      c.width = frame.width;
      c.height = frame.height;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(frame, 0, 0);
      for (const s of strokes) drawStroke(ctx, s, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) =>
        c.toBlob(r, "image/jpeg", 0.85)
      );
      if (!blob) throw new Error("no blob");
      await onSave(blob);
    } catch {
      setError("Couldn't save the drawing. Try again.");
      setSaving(false);
    }
  };

  const toolBtn = (t: Tool, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setTool(t)}
      aria-pressed={tool === t}
      aria-label={label}
      title={label}
      className={`rounded-full p-2 transition-colors ${
        tool === t
          ? "bg-white/15 text-white"
          : "text-zinc-400 hover:text-white"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-ink">
      {/* top bar: leave / tools / keep — sized to fit a 375px phone */}
      <div className="flex items-center justify-between gap-1 p-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          title="Cancel"
          className="rounded-full border border-edge bg-ink/70 p-2 text-zinc-300 transition-colors hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="flex items-center gap-0.5">
          {toolBtn(
            "pen",
            "Pen",
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L8.5 19 4 20Z"
              />
            </svg>
          )}
          {toolBtn(
            "arrow",
            "Arrow",
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 19 19 5m0 0h-7m7 0v7"
              />
            </svg>
          )}
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setColor(c.value)}
              aria-pressed={color === c.value}
              aria-label={`${c.name} ink`}
              title={`${c.name} ink`}
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-transform ${
                color === c.value ? "scale-110 ring-2 ring-white/70" : ""
              }`}
            >
              <span
                className="h-4 w-4 rounded-full"
                style={{ backgroundColor: c.value }}
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setStrokes((all) => all.slice(0, -1))}
            disabled={strokes.length === 0}
            aria-label="Undo"
            title="Undo"
            className="rounded-full p-2 text-zinc-400 transition-colors hover:text-white disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 5 3.5 9.5 8 14M4 9.5h10a6 6 0 0 1 0 12h-3"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setStrokes([])}
            disabled={strokes.length === 0}
            aria-label="Clear all"
            title="Clear all"
            className="rounded-full p-2 text-zinc-400 transition-colors hover:text-white disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.7 12.1a2 2 0 0 1-2 1.9H8.7a2 2 0 0 1-2-1.9L6 7"
              />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="glow-cta shrink-0 rounded-full bg-cyan-glow px-3.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* drawing surface */}
      <div
        ref={areaRef}
        className="relative flex min-h-0 flex-1 items-center justify-center"
      >
        {error ? (
          <p className="max-w-xs p-6 text-center text-sm text-zinc-400">
            {error}
          </p>
        ) : (
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="cursor-crosshair select-none"
            style={{ touchAction: "none" }}
          />
        )}
      </div>
    </div>
  );
}
