"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FeedbackBoard } from "./FeedbackBoard";

/**
 * Feedback 2.0 composer + board (SPEC: Feedback system).
 *
 * One box, one button. On send the item is inserted immediately with
 * defaults (title = first 8 words, type idea, board) and the confirmation
 * shows instantly; /api/feedback/assist then polishes it in the background
 * (title/type/routing) and may return a "similar item" pointer or up to two
 * follow-up questions, all rendered under the confirmation and all
 * skippable. Voice input reuses the Notes mic flow via /api/transcribe.
 */

type MatchOption = {
  id: string;
  opponent_name: string | null;
  played_at: string;
};

type AssistResponse = {
  questions: string[];
  similar: { id: string; title: string } | null;
  visibility: string;
};

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

function matchLabel(m: MatchOption) {
  const name = m.opponent_name?.trim() || "Match";
  const date = new Date(m.played_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${name} · ${date}`;
}

function firstWords(text: string, n = 8) {
  return text.trim().split(/\s+/).slice(0, n).join(" ").slice(0, 120);
}

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** MediaRecorder -> /api/transcribe -> transcript via callback. */
function useVoiceInput(onTranscript: (text: string) => void) {
  const [recState, setRecState] = useState<
    "idle" | "recording" | "transcribing"
  >("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(
    () => () => {
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    },
    []
  );

  const transcribe = useCallback(async (blob: Blob) => {
    if (blob.size > MAX_AUDIO_BYTES) {
      setError("Keep recordings under 10 MB.");
      setRecState("idle");
      return;
    }
    setRecState("transcribing");
    try {
      const form = new FormData();
      const ext = blob.type.includes("mp4") ? "note.mp4" : "note.webm";
      form.append("audio", blob, ext);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = res.ok ? await res.json() : null;
      const transcript = String(data?.transcript ?? "").trim();
      if (!transcript) throw new Error("empty transcript");
      onTranscriptRef.current(transcript);
    } catch {
      setError("Couldn't transcribe that. Try again.");
    } finally {
      setRecState("idle");
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined") {
      setError("Voice input isn't supported in this browser.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked.");
      return;
    }
    const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(
      (t) => MediaRecorder.isTypeSupported(t)
    );
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      if (blob.size === 0) {
        setRecState("idle");
        return;
      }
      void transcribe(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setElapsed(0);
    setRecState("recording");
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }, [transcribe]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  return { recState, elapsed, error, start, stop };
}

function MicButton({
  recState,
  elapsed,
  onStart,
  onStop,
  size = "md",
}: {
  recState: "idle" | "recording" | "transcribing";
  elapsed: number;
  onStart: () => void;
  onStop: () => void;
  size?: "md" | "sm";
}) {
  const dim = size === "md" ? "h-11 w-11" : "h-9 w-9";
  const icon = size === "md" ? "h-5 w-5" : "h-4 w-4";
  if (recState === "recording") {
    return (
      <button
        type="button"
        onClick={onStop}
        aria-label="Stop recording"
        className={`flex ${dim} shrink-0 items-center justify-center gap-1 rounded-full bg-red-500 text-white`}
      >
        <svg viewBox="0 0 24 24" className={icon} fill="currentColor" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
        </svg>
        <span className="sr-only">{fmtElapsed(elapsed)}</span>
      </button>
    );
  }
  if (recState === "transcribing") {
    return (
      <span
        className={`flex ${dim} shrink-0 items-center justify-center rounded-full border border-edge bg-ink/40`}
      >
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-glow" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onStart}
      aria-label="Dictate"
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full border border-edge bg-ink/40 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white`}
    >
      <svg
        viewBox="0 0 24 24"
        className={icon}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path strokeLinecap="round" d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  );
}

export function FeedbackForm({
  userId,
  isAdmin,
  initialMatchId,
}: {
  userId: string;
  isAdmin: boolean;
  initialMatchId: string | null;
}) {
  const [body, setBody] = useState("");
  const [matchId, setMatchId] = useState(initialMatchId ?? "");
  const [matches, setMatches] = useState<MatchOption[]>([]);
  const [phase, setPhase] = useState<"compose" | "sending" | "sent">("compose");
  const [sendError, setSendError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // post-send assist state
  const [itemId, setItemId] = useState<string | null>(null);
  const [assist, setAssist] = useState<AssistResponse | null>(null);
  const [similarState, setSimilarState] = useState<
    "pending" | "kept" | "merged"
  >("pending");
  const [qIndex, setQIndex] = useState(0);
  const [answer, setAnswer] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const mainVoice = useVoiceInput((t) =>
    setBody((prev) => (prev.trim() ? `${prev.trimEnd()}\n${t}` : t))
  );
  const answerVoice = useVoiceInput((t) =>
    setAnswer((prev) => (prev.trim() ? `${prev.trimEnd()} ${t}` : t))
  );

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("matches")
      .select("id, opponent_name, played_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setMatches(data as MatchOption[]);
      });
  }, [userId]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const send = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setPhase("sending");
    setSendError(false);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("feedback_items")
      .insert({
        user_id: userId,
        match_id: matchId || null,
        body: trimmed,
        title: firstWords(trimmed) || "Feedback",
      })
      .select("id")
      .single();
    if (error || !data) {
      setPhase("compose");
      setSendError(true);
      return;
    }
    const newId = data.id as string;
    setItemId(newId);
    setAssist(null);
    setSimilarState("pending");
    setQIndex(0);
    setAnswer("");
    setPhase("sent");
    setRefreshKey((k) => k + 1);

    // Background polish; the item is already saved.
    try {
      const res = await fetch("/api/feedback/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed, itemId: newId }),
      });
      const parsed: AssistResponse = res.ok
        ? await res.json()
        : { questions: [], similar: null, visibility: "board" };
      setAssist({
        questions: (parsed.questions ?? []).slice(0, 2),
        similar: parsed.similar ?? null,
        visibility: parsed.visibility ?? "board",
      });
    } catch {
      setAssist({ questions: [], similar: null, visibility: "board" });
    }
    setRefreshKey((k) => k + 1);
  }, [body, matchId, userId]);

  const mergeIntoSimilar = useCallback(async () => {
    if (!assist?.similar || !itemId) return;
    const supabase = createClient();
    await supabase.rpc("feedback_toggle_vote", { p_item: assist.similar.id });
    await supabase.rpc("feedback_decline_duplicate", { p_item: itemId });
    setSimilarState("merged");
    setRefreshKey((k) => k + 1);
  }, [assist, itemId]);

  const submitAnswer = useCallback(async () => {
    const q = assist?.questions[qIndex];
    const a = answer.trim();
    if (!q || !itemId || !a) return;
    setQIndex((i) => i + 1);
    setAnswer("");
    const supabase = createClient();
    await supabase.rpc("feedback_append_qa", {
      p_item: itemId,
      p_question: q,
      p_answer: a,
    });
    setRefreshKey((k) => k + 1);
  }, [assist, qIndex, answer, itemId]);

  const reset = useCallback(() => {
    setBody("");
    setMatchId(initialMatchId ?? "");
    setPhase("compose");
    setItemId(null);
    setAssist(null);
    setAnswer("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [initialMatchId]);

  const merged = similarState === "merged";
  const showSimilar =
    phase === "sent" && !merged && similarState === "pending" && !!assist?.similar;
  const questions = assist?.questions ?? [];
  const currentQ = !merged && qIndex < questions.length ? questions[qIndex] : null;

  const confirmationLine = merged
    ? `Vote added to "${assist?.similar?.title}".`
    : assist === null
      ? "Sent."
      : assist.visibility === "private"
        ? "Sent to us."
        : "Posted — others can upvote it.";

  return (
    <div>
      {phase === "sent" ? (
        <div className="rounded-2xl border border-edge bg-surface p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-emerald-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4 10-10" />
              </svg>
            </span>
            <p className="font-medium text-zinc-100">{confirmationLine}</p>
          </div>

          {showSimilar && assist?.similar && (
            <div className="mt-4 rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 px-4 py-3">
              <p className="text-sm text-zinc-300">
                Similar: &ldquo;{assist.similar.title}&rdquo; — add your vote
                instead?
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void mergeIntoSimilar()}
                  className="rounded-full bg-cyan-glow px-4 py-1.5 text-xs font-semibold text-ink"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => setSimilarState("kept")}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
                >
                  Keep mine
                </button>
              </div>
            </div>
          )}

          {!showSimilar && currentQ && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-zinc-100">{currentQ}</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitAnswer();
                  }}
                  placeholder="Answer (optional)"
                  className="h-9 min-w-0 flex-1 rounded-full border border-edge bg-ink/60 px-4 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50"
                />
                <MicButton
                  size="sm"
                  recState={answerVoice.recState}
                  elapsed={answerVoice.elapsed}
                  onStart={() => void answerVoice.start()}
                  onStop={answerVoice.stop}
                />
                <button
                  type="button"
                  disabled={!answer.trim()}
                  onClick={() => void submitAnswer()}
                  className="rounded-full bg-cyan-glow px-3.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnswer("");
                    setQIndex((i) => i + 1);
                  }}
                  className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  Skip
                </button>
              </div>
              {answerVoice.error && (
                <p className="mt-2 text-xs text-red-400">{answerVoice.error}</p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={reset}
            className="mt-4 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300"
          >
            Send another
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-edge bg-surface p-5 sm:p-6">
          {mainVoice.recState === "recording" ? (
            <div className="flex h-24 items-center gap-3 rounded-xl border border-red-500/50 bg-red-500/10 px-4">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="text-sm tabular-nums text-red-300">
                {fmtElapsed(mainVoice.elapsed)}
              </span>
              <span className="flex-1 truncate text-xs text-zinc-500">
                Recording…
              </span>
              <button
                type="button"
                onClick={mainVoice.stop}
                aria-label="Stop recording"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="1.5" />
                </svg>
              </button>
            </div>
          ) : mainVoice.recState === "transcribing" ? (
            <div className="flex h-24 items-center gap-3 rounded-xl border border-edge bg-ink/60 px-4">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-glow" />
              <span className="text-sm text-zinc-400">Transcribing…</span>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                autoGrow();
              }}
              rows={3}
              placeholder="A bug, an idea, anything."
              className="w-full resize-none rounded-xl border border-edge bg-surface-2/60 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50"
            />
          )}

          {matches.length > 0 && (
            <select
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              aria-label="About a match?"
              className="mt-3 w-full appearance-none rounded-xl border border-edge bg-surface-2/60 px-4 py-2.5 text-sm text-zinc-300 focus:border-cyan-glow/50 focus:outline-none"
            >
              <option value="">Not about a specific match</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {matchLabel(m)}
                </option>
              ))}
            </select>
          )}

          {(sendError || mainVoice.error) && (
            <p className="mt-3 text-sm text-red-400">
              {mainVoice.error ?? "Could not send. Try again."}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <MicButton
              recState={mainVoice.recState}
              elapsed={mainVoice.elapsed}
              onStart={() => void mainVoice.start()}
              onStop={mainVoice.stop}
            />
            <button
              type="button"
              disabled={phase === "sending" || !body.trim()}
              onClick={() => void send()}
              className="glow-cta rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {phase === "sending" ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}

      <FeedbackBoard isAdmin={isAdmin} refreshKey={refreshKey} />
    </div>
  );
}
