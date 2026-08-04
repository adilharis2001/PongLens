"use client";

import { useEffect, useRef, useState } from "react";

import { Annotator } from "@/app/match/[id]/Annotator";
import { ClipPlayer } from "@/app/match/[id]/ClipPlayer";
import type { ReviewFindingRow } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/client";
import type { WorkspacePoint } from "./CoachOrder";
import { AutoTextarea } from "@/components/AutoTextarea";

/**
 * The findings builder. A finding is one observation — typed, spoken or
 * drawn — linked to the rallies that show it. Tap a point to start one;
 * link more points to the same finding when a pattern repeats.
 *
 * Voice records through /api/transcribe with tier=review (permanent
 * storage, transcript lands in the body). Drawing captures the on-screen
 * clip frame (WebKit black-frames hidden videos — same rule as the match
 * page) and stores through /api/note-image.
 */

function chipClass(p: WorkspacePoint, linked: boolean): string {
  const base =
    "h-9 min-w-9 rounded-full border px-2 text-xs font-medium tabular-nums transition-colors ";
  if (linked) return base + "border-cyan-glow bg-cyan-glow/15 text-cyan-glow";
  if (p.is_let) return base + "border-amber-400/40 text-amber-400/80";
  if (p.confirmed_winner === "user")
    return base + "border-cyan-glow/40 text-zinc-200";
  if (p.confirmed_winner === "opponent")
    return base + "border-magenta-glow/40 text-zinc-200";
  return base + "border-dashed border-edge text-zinc-400";
}

function PointStrip({
  points,
  linkedIds,
  onPick,
}: {
  points: WorkspacePoint[];
  linkedIds: Set<string>;
  onPick: (p: WorkspacePoint) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {points.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p)}
          className={chipClass(p, linkedIds.has(p.id))}
        >
          {p.starred ? "★" : ""}
          {p.idx + 1}
        </button>
      ))}
    </div>
  );
}

function ClipPane({
  matchId,
  pointId,
  onVideoEl,
}: {
  matchId: string;
  pointId: string;
  onVideoEl: (el: HTMLVideoElement | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    const load = async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ matchId, pointId }),
        });
        const data = (await res.json()) as { url?: string };
        if (alive && res.ok && data.url) setUrl(data.url);
      } catch {
        // clip stays absent; the finding still edits fine
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [matchId, pointId]);

  useEffect(() => {
    const t = setInterval(() => {
      onVideoEl(videoElRef.current);
    }, 300);
    return () => clearInterval(t);
  }, [onVideoEl]);

  if (!url) {
    return (
      <div className="aspect-video w-full animate-pulse rounded-xl border border-edge bg-surface-2" />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-edge">
      <ClipPlayer src={url} videoElRef={videoElRef} />
    </div>
  );
}

export function FindingEditor({
  orderId,
  matchId,
  points,
  findings,
  findingPoints,
  onChanged,
}: {
  orderId: string;
  matchId: string | null;
  points: WorkspacePoint[];
  findings: ReviewFindingRow[];
  findingPoints: Record<string, { point_id: string; idx: number }[]>;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const allLinked = new Set(
    Object.values(findingPoints).flatMap((l) => l.map((x) => x.point_id)),
  );

  async function createFinding(point: WorkspacePoint | null) {
    if (creating) return;
    setCreating(true);
    const supabase = createClient();
    const { data: finding, error } = await supabase
      .from("review_findings")
      .insert({ order_id: orderId, sort: findings.length })
      .select()
      .single();
    if (!error && finding && point) {
      await supabase
        .from("review_finding_points")
        .insert({ finding_id: finding.id, point_id: point.id });
    }
    setCreating(false);
    onChanged();
  }

  return (
    <div className="mt-3">
      {points.length > 0 && (
        <div className="rounded-2xl border border-edge bg-surface p-4">
          <p className="mb-3 text-xs text-zinc-500">
            Tap a point to start a finding. Points already in one glow.
          </p>
          <PointStrip
            points={points}
            linkedIds={allLinked}
            onPick={(p) => void createFinding(p)}
          />
          <button
            type="button"
            onClick={() => void createFinding(null)}
            disabled={creating}
            className="mt-3 text-xs text-zinc-500 hover:text-cyan-glow"
          >
            Or add a note without a point
          </button>
        </div>
      )}
      {points.length === 0 && (
        <button
          type="button"
          onClick={() => void createFinding(null)}
          disabled={creating}
          className="rounded-full border border-edge bg-surface px-4 py-2 text-xs font-medium text-zinc-300 hover:border-cyan-glow/40"
        >
          Add a finding
        </button>
      )}

      <div className="mt-4 space-y-4">
        {findings.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            linked={findingPoints[f.id] ?? []}
            points={points}
            matchId={matchId}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

function FindingCard({
  finding,
  linked,
  points,
  matchId,
  onChanged,
}: {
  finding: ReviewFindingRow;
  linked: { point_id: string; idx: number }[];
  points: WorkspacePoint[];
  matchId: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(
    finding.title === "" && finding.body === "",
  );
  const [title, setTitle] = useState(finding.title);
  const [body, setBody] = useState(finding.body);
  const [audioPath, setAudioPath] = useState(finding.audio_path);
  const [imagePath, setImagePath] = useState(finding.image_path);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [frame, setFrame] = useState<HTMLCanvasElement | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const videoEl = useRef<HTMLVideoElement | null>(null);

  const previewPoint = linked[0] ?? null;
  const linkedIds = new Set(linked.map((l) => l.point_id));

  async function save(extra?: Partial<ReviewFindingRow>) {
    setBusy(true);
    const { error } = await createClient()
      .from("review_findings")
      .update({
        title: title.trim().slice(0, 120),
        body: body.slice(0, 4000),
        audio_path: audioPath,
        image_path: imagePath,
        ...extra,
      })
      .eq("id", finding.id);
    setBusy(false);
    if (error) {
      setNote("Could not save. Try again.");
      return false;
    }
    onChanged();
    return true;
  }

  async function remove() {
    setBusy(true);
    await createClient()
      .from("review_findings")
      .delete()
      .eq("id", finding.id);
    setBusy(false);
    onChanged();
  }

  async function toggleLink(p: WorkspacePoint) {
    const supabase = createClient();
    if (linkedIds.has(p.id)) {
      await supabase
        .from("review_finding_points")
        .delete()
        .eq("finding_id", finding.id)
        .eq("point_id", p.id);
    } else {
      await supabase
        .from("review_finding_points")
        .insert({ finding_id: finding.id, point_id: p.id });
    }
    onChanged();
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setTranscribing(true);
        try {
          const blob = new Blob(chunks.current, { type: mime });
          const form = new FormData();
          form.append("audio", blob, `finding${mime === "audio/webm" ? ".webm" : ".mp4"}`);
          form.append("tier", "review");
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });
          const data = (await res.json()) as {
            audio_path?: string;
            transcript?: string;
          };
          if (res.ok && data.audio_path) {
            setAudioPath(data.audio_path);
            if (data.transcript) {
              setBody((prev) =>
                prev ? `${prev}\n${data.transcript}` : (data.transcript ?? ""),
              );
            }
          } else {
            setNote("Could not process the recording.");
          }
        } catch {
          setNote("Could not process the recording.");
        }
        setTranscribing(false);
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      setNote("Microphone unavailable.");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
  }

  function openDraw() {
    const el = videoEl.current;
    if (!el || el.videoWidth === 0) {
      setNote("Let the clip load first.");
      return;
    }
    el.pause();
    try {
      const canvas = document.createElement("canvas");
      canvas.width = el.videoWidth;
      canvas.height = el.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(el, 0, 0);
      // A tainted canvas throws here, not at drawImage.
      ctx.getImageData(0, 0, 1, 1);
      setFrame(canvas);
      setDrawing(true);
    } catch {
      setNote("Drawing isn't available for this clip.");
    }
  }

  async function saveDrawing(blob: Blob) {
    const form = new FormData();
    form.append("image", blob, "finding.jpg");
    const res = await fetch("/api/note-image", { method: "POST", body: form });
    const data = (await res.json()) as { image_path?: string };
    if (!res.ok || !data.image_path) throw new Error("upload failed");
    setImagePath(data.image_path);
    setDrawing(false);
    setFrame(null);
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <p className="min-w-0 truncate text-sm font-medium text-zinc-200">
          {title || body.split("\n")[0] || "New finding"}
        </p>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {linked.map((l) => l.idx + 1).join(", ") || "no points"}
        </span>
      </button>

      {open && (
        <div className="border-t border-edge/60 px-5 pb-5 pt-4">
          {previewPoint && matchId && (
            <ClipPane
              matchId={matchId}
              pointId={previewPoint.point_id}
              onVideoEl={(el) => {
                videoEl.current = el;
              }}
            />
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {linked.map((l) => (
              <span
                key={l.point_id}
                className="rounded-full border border-cyan-glow/40 px-2.5 py-1 text-xs tabular-nums text-cyan-glow"
              >
                {l.idx + 1}
              </span>
            ))}
            <button
              type="button"
              onClick={() => setLinking(!linking)}
              className="rounded-full border border-edge px-2.5 py-1 text-xs text-zinc-400 hover:border-cyan-glow/40"
            >
              {linking ? "Done" : "Edit points"}
            </button>
          </div>
          {linking && (
            <div className="mt-3">
              <PointStrip
                points={points}
                linkedIds={linkedIds}
                onPick={(p) => void toggleLink(p)}
              />
            </div>
          )}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Name the pattern"
            className="mt-4 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm font-medium text-zinc-100 outline-none focus:border-cyan-glow/50"
          />
          <AutoTextarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="What you see and what to change"
            className="mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm leading-relaxed text-zinc-100 outline-none focus:border-cyan-glow/50"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={transcribing}
              className={`rounded-full border px-4 py-2 text-xs font-medium transition-colors ${
                recording
                  ? "border-amber-400/60 text-amber-400"
                  : "border-edge text-zinc-300 hover:border-cyan-glow/40"
              }`}
            >
              {recording
                ? "Stop"
                : transcribing
                  ? "Transcribing"
                  : audioPath
                    ? "Re-record voice"
                    : "Dictate"}
            </button>
            {audioPath && !recording && (
              <button
                type="button"
                onClick={() => setAudioPath(null)}
                className="text-xs text-zinc-500 hover:text-amber-400"
              >
                Remove voice note
              </button>
            )}
            {previewPoint && matchId && (
              <button
                type="button"
                onClick={openDraw}
                className="rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-300 hover:border-cyan-glow/40"
              >
                {imagePath ? "Redraw" : "Draw on the frame"}
              </button>
            )}
            {imagePath && (
              <button
                type="button"
                onClick={() => setImagePath(null)}
                className="text-xs text-zinc-500 hover:text-amber-400"
              >
                Remove drawing
              </button>
            )}
          </div>

          {note && <p className="mt-3 text-xs text-amber-400">{note}</p>}

          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="text-xs text-zinc-500 hover:text-amber-400"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await save()) setOpen(false);
              }}
              disabled={busy}
              className="glow-cta rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {busy ? "Saving" : "Save"}
            </button>
          </div>
        </div>
      )}

      {drawing && frame && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4">
          <div className="w-full max-w-2xl">
            <Annotator
              frame={frame}
              onCancel={() => {
                setDrawing(false);
                setFrame(null);
              }}
              onSave={saveDrawing}
            />
          </div>
        </div>
      )}
    </div>
  );
}
