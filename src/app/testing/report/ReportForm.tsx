"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  KIND_LABEL,
  SEVERITY_LABEL,
  type BugArea,
  type BugKind,
  type BugSeverity,
} from "@/lib/qa/bugs";
import { TEST_AREAS, testCases } from "@/lib/qa/testLibrary";
import { matchOptionLabel, parseMatchRef } from "@/lib/qa/matchRef";

const MAX_ATTACHMENTS = 6;

/** The reporter's own matches, for the picker. RLS does the filtering. */
export interface MatchOption {
  id: string;
  played_at: string | null;
  created_at: string;
  opponent_name: string | null;
  status: string | null;
}

/** Not a match id, and no match id can collide with it. */
const PASTE = "__paste";

interface Pending {
  localId: string;
  name: string;
  previewUrl: string;
  kind: "image" | "video";
  status: "uploading" | "ready" | "failed";
  key?: string;
  w?: number;
  h?: number;
}

/** A readable guess at the device, which the tester can correct. */
function guessDevice(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "";
}

function guessBrowser(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  // Order matters: Chrome and Edge both claim Safari, Edge claims Chrome.
  if (/Edg\//.test(ua)) return "Edge";
  if (/CriOS|Chrome\//.test(ua)) return "Chrome";
  if (/FxiOS|Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "";
}

/**
 * What actually went wrong, in a sentence. "Could not save that. Try
 * again." was the whole message for every failure, and the one failure it
 * met in the wild — a value Postgres would never accept — was the one
 * where trying again could not possibly help. A tester who cannot see the
 * cause cannot report it, which defeats the point of the tester.
 *
 * Codes are Postgres's, arriving through PostgREST.
 */
function saveFailureMessage(err: { code?: string; message?: string } | null) {
  switch (err?.code) {
    case "22P02":
      return "One of the ids is not a valid identifier. Pick the match from the list.";
    case "23503":
      return "There is no match with that id on this account.";
    case "23514":
      return "One of the choices above is not one this form knows. Reload and try again.";
    case "42501":
    case "PGRST301":
      return "Your session has expired. Reload the page, sign in again, and the form will still have what you typed.";
    default:
      return err?.message
        ? `Could not save that: ${err.message}`
        : "Could not save that. Reload the page and try again.";
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-zinc-200">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-edge bg-ink/60 px-4 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50";

export function ReportForm({
  userId,
  initialCaseId,
  initialMatchId,
  matches,
  buildSha,
  billingMode,
}: {
  userId: string;
  initialCaseId: string;
  initialMatchId: string;
  matches: MatchOption[];
  buildSha: string | null;
  billingMode: "live" | "test" | null;
}) {
  const [caseId, setCaseId] = useState(initialCaseId);
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [kind, setKind] = useState<BugKind>("functional");
  const [area, setArea] = useState<BugArea>("other");
  const [severity, setSeverity] = useState<BugSeverity>("major");
  const [device, setDevice] = useState("");
  const [url, setUrl] = useState("");
  // Two controls for one value: the picker for the common path, and a
  // paste box for a match that is not in the list. Only one is on screen.
  const [picked, setPicked] = useState(() => {
    if (!initialMatchId) return "";
    return matches.some((m) => m.id === initialMatchId)
      ? initialMatchId
      : PASTE;
  });
  const [pasted, setPasted] = useState(() =>
    initialMatchId && !matches.some((m) => m.id === initialMatchId)
      ? initialMatchId
      : "",
  );
  const [videoSeconds, setVideoSeconds] = useState("");
  const [attachments, setAttachments] = useState<Pending[]>([]);
  const [phase, setPhase] = useState<"compose" | "saving" | "sent">("compose");
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The library case, if we arrived from one, sets the area so the tester
  // does not have to classify a bug in a part of the app they are still
  // learning.
  useEffect(() => {
    setDevice(guessDevice());
    if (!initialCaseId) return;
    const found = testCases.find((c) => c.id === initialCaseId);
    if (found) setArea(found.area);
  }, [initialCaseId]);

  const upload = useCallback(async (files: File[]) => {
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) return;
    const batch = files.slice(0, room);

    const staged: Pending[] = batch.map((file, i) => ({
      localId: `${Date.now()}-${i}-${file.name}`,
      name: file.name || (file.type.startsWith("video") ? "recording" : "screenshot"),
      previewUrl: URL.createObjectURL(file),
      kind: file.type.startsWith("video") ? "video" : "image",
      status: "uploading",
    }));
    setAttachments((prev) => [...prev, ...staged]);

    await Promise.all(
      batch.map(async (file, i) => {
        const localId = staged[i].localId;
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/qa/attachment", {
            method: "POST",
            body: form,
          });
          if (!res.ok) throw new Error(String(res.status));
          const { key, kind: k } = (await res.json()) as {
            key: string;
            kind: "image" | "video";
          };
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === localId ? { ...a, status: "ready", key, kind: k } : a,
            ),
          );
        } catch {
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === localId ? { ...a, status: "failed" } : a,
            ),
          );
        }
      }),
    );
  }, [attachments.length]);

  // Ctrl+V / Cmd+V anywhere on the page. A screenshot goes to the clipboard
  // as an image blob with no file name, which is exactly what a tester has
  // after pressing the system screenshot shortcut.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const files = items
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length === 0) return;
      e.preventDefault();
      void upload(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) void upload(files);
    },
    [upload],
  );

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => {
      const going = prev.find((a) => a.localId === localId);
      if (going) URL.revokeObjectURL(going.previewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  }, []);

  const uploading = attachments.some((a) => a.status === "uploading");
  const canSave =
    title.trim().length > 0 && steps.trim().length > 0 && !uploading;

  const save = useCallback(async () => {
    if (!canSave) return;

    // Resolve the match first, and locally. Sending a bad id and letting
    // Postgres refuse it is how this field spent a day telling a tester
    // to "try again" at something that could never work.
    const ref = parseMatchRef(picked === PASTE ? pasted : picked);
    if (!ref.ok) {
      setError(ref.message);
      return;
    }

    setPhase("saving");
    setError(null);

    const seconds = videoSeconds.trim();
    // Accept both "132" and "2:12", because a tester reads a timestamp off
    // a scrubber, not off a stopwatch.
    let parsedSeconds: number | null = null;
    if (seconds) {
      if (seconds.includes(":")) {
        const [m, s] = seconds.split(":");
        const mins = Number(m);
        const secs = Number(s);
        if (Number.isFinite(mins) && Number.isFinite(secs)) {
          parsedSeconds = mins * 60 + secs;
        }
      } else if (Number.isFinite(Number(seconds))) {
        parsedSeconds = Number(seconds);
      }
    }

    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("qa_bugs")
      .insert({
        reporter_id: userId,
        title: title.trim(),
        steps: steps.trim(),
        expected: expected.trim(),
        actual: actual.trim(),
        kind,
        area,
        severity,
        device: device.trim(),
        browser: guessBrowser(),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        url: url.trim(),
        build_sha: buildSha,
        billing_mode: billingMode,
        case_id: caseId.trim(),
        match_id: ref.id,
        video_seconds: parsedSeconds,
        attachments: attachments
          .filter((a) => a.status === "ready" && a.key)
          .map((a) => ({ key: a.key as string, kind: a.kind })),
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setPhase("compose");
      setError(saveFailureMessage(insertError));
      return;
    }
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setSavedId(data.id as string);
    setPhase("sent");
  }, [
    canSave,
    userId,
    title,
    steps,
    expected,
    actual,
    kind,
    area,
    severity,
    device,
    url,
    buildSha,
    billingMode,
    caseId,
    picked,
    pasted,
    videoSeconds,
    attachments,
  ]);

  if (phase === "sent") {
    return (
      <div className="mt-8 rounded-2xl border border-edge bg-surface p-6">
        <p className="text-base font-medium text-zinc-100">Filed.</p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          It is in the queue. You will get an email once it is closed, and it
          comes back to you to verify if it gets fixed.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/testing/bugs"
            className="rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink"
          >
            See the queue
          </Link>
          <button
            type="button"
            onClick={() => {
              setTitle("");
              setSteps("");
              setExpected("");
              setActual("");
              setPicked("");
              setPasted("");
              setVideoSeconds("");
              setUrl("");
              setAttachments([]);
              setSavedId(null);
              setPhase("compose");
            }}
            className="rounded-full border border-edge px-5 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-cyan-glow"
          >
            File another
          </button>
        </div>
        {savedId && (
          <p className="mt-4 font-mono text-[11px] text-zinc-600">{savedId}</p>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`mt-8 rounded-2xl border p-5 transition-colors sm:p-6 ${
        dragging ? "border-cyan-glow/60 bg-cyan-glow/5" : "border-edge bg-surface"
      }`}
    >
      <div className="space-y-5">
        <Field label="What broke" hint="One line, the way you would say it out loud.">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Clip player restarts when you drag the scrubber"
          />
        </Field>

        <Field
          label="Steps to reproduce"
          hint="Numbered, starting from a signed-out browser if that matters."
        >
          <textarea
            className={`${inputClass} min-h-28 resize-y`}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={"1. Open a processed match\n2. Tap point 4\n3. Drag the scrubber past halfway"}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="What should have happened">
            <textarea
              className={`${inputClass} min-h-20 resize-y`}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </Field>
          <Field label="What happened instead">
            <textarea
              className={`${inputClass} min-h-20 resize-y`}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
          </Field>
        </div>

        {/* Evidence. Paste is the fast path and the one worth advertising. */}
        <div>
          <span className="block text-sm font-medium text-zinc-200">
            Screenshots and recordings
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500">
            Paste with Ctrl+V, drag files anywhere onto this form, or choose
            them. Video is the only way to show a stutter.
          </span>

          {attachments.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-3">
              {attachments.map((a) => (
                <li key={a.localId} className="relative">
                  <div className="h-20 w-20 overflow-hidden rounded-lg border border-edge bg-ink/40">
                    {a.kind === "video" ? (
                      <video
                        src={a.previewUrl}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  {a.status !== "ready" && (
                    <span
                      className={`absolute inset-0 flex items-center justify-center rounded-lg text-[10px] font-semibold ${
                        a.status === "failed"
                          ? "bg-ink/80 text-amber-300"
                          : "bg-ink/60 text-zinc-300"
                      }`}
                    >
                      {a.status === "failed" ? "Failed" : "Uploading"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.localId)}
                    className="mt-1.5 block w-full text-center text-sm text-zinc-400 transition-colors hover:text-zinc-100"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void upload(files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={attachments.length >= MAX_ATTACHMENTS}
            className="mt-3 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-cyan-glow disabled:opacity-40"
          >
            Choose files
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Kind">
            <select
              className={inputClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as BugKind)}
            >
              {(Object.keys(KIND_LABEL) as BugKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Area">
            <select
              className={inputClass}
              value={area}
              onChange={(e) => setArea(e.target.value as BugArea)}
            >
              {TEST_AREAS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.title}
                </option>
              ))}
              <option value="other">Something else</option>
            </select>
          </Field>
          <Field label="Severity">
            <select
              className={inputClass}
              value={severity}
              onChange={(e) => setSeverity(e.target.value as BugSeverity)}
            >
              {(Object.keys(SEVERITY_LABEL) as BugSeverity[]).map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Device" hint="Correct this if the guess is wrong.">
            <input
              className={inputClass}
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              placeholder="iPhone 14, iOS 17.5"
            />
          </Field>
          <Field label="Page" hint="The address where it happened.">
            <input
              className={inputClass}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/match/..."
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Match"
            hint="Only for a bug about a video. Leave it alone otherwise."
          >
            <select
              className={inputClass}
              value={picked}
              onChange={(e) => {
                setPicked(e.target.value);
                setError(null);
              }}
            >
              <option value="">Not about a match</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {matchOptionLabel(m)}
                </option>
              ))}
              <option value={PASTE}>Paste a link instead</option>
            </select>
            {picked === PASTE && (
              <input
                className={`${inputClass} mt-2`}
                value={pasted}
                onChange={(e) => {
                  setPasted(e.target.value);
                  setError(null);
                }}
                placeholder="https://www.ponglens.com/match/..."
              />
            )}
          </Field>
          <Field label="Time in the video" hint="Either 2:12 or 132.">
            <input
              className={inputClass}
              value={videoSeconds}
              onChange={(e) => setVideoSeconds(e.target.value)}
              placeholder="2:12"
            />
          </Field>
        </div>

        <Field label="Library case" hint="Filled in when you come from a case.">
          <input
            className={inputClass}
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="match-seek"
          />
        </Field>
      </div>

      {error && <p className="mt-5 text-sm text-amber-300">{error}</p>}

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave || phase === "saving"}
          className="rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink transition-opacity disabled:opacity-40"
        >
          {phase === "saving" ? "Filing" : "File it"}
        </button>
        {uploading && (
          <span className="text-sm text-zinc-500">Waiting for the upload</span>
        )}
        {!title.trim() || !steps.trim() ? (
          <span className="text-sm text-zinc-500">
            Needs a title and steps.
          </span>
        ) : null}
      </div>
    </div>
  );
}
