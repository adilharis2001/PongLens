import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/lesson — save a lesson and distill its takeaways.
 *
 *   { transcript } -> { id, status, takeaways? }
 *
 * The row is written first (status 'queued') so the text is never lost,
 * then distilled in-request and updated to 'ready' (or 'failed', which the
 * UI can retry via { lessonId }). Short text (under ~600 chars) is stored
 * as-is with no takeaways — it reads fine on its own.
 *
 * Distillation contract (this is what keeps it trustworthy): only what the
 * coach actually said may appear, phrased as short actionable reminders
 * grouped under a few themes. Transcripts arrive as noisy speech-to-text
 * with mis-heard words; the model reads through that but never invents
 * advice to fill gaps. No meta-commentary, no fluff, no essay.
 */

const DISTILL_MODEL = "gpt-5-mini";
const MIN_DISTILL_CHARS = 600;

const PROMPT = `You are distilling a table-tennis coaching session for the player who was coached. The input is a raw speech-to-text transcript: it is noisy, has mis-transcribed words, and mixes small talk with actual coaching.

Extract ONLY the coaching content — technique corrections, tactical advice, drills and their purpose, things the coach told the player to practice or remember. Ignore greetings, scheduling, gossip, and anything not about playing.

Rules:
- Every point must come from something actually said in the transcript. Never invent advice, never generalize beyond what was said. If the transcript garbled a word, infer the table-tennis meaning only when it is obvious; otherwise drop it.
- Write each point as one short, memorable, actionable sentence in the second person ("Keep the racket up between backhand strokes"). No headings inside points, no sub-bullets, no explanations.
- Group points under 2-6 short theme names the player would recognize (e.g. "Backhand", "Stance & balance", "Serve & receive", "Match tactics"). Use the themes the session actually covered.
- 2-5 points per theme. Fewer, sharper points beat completeness.
- Also produce a 3-6 word title naming what the session was mostly about.

Return ONLY JSON: {"title": string, "themes": [{"name": string, "points": [string]}]}`;

interface Takeaways {
  title: string;
  themes: { name: string; points: string[] }[];
}

function parseTakeaways(raw: string): Takeaways | null {
  try {
    const data = JSON.parse(raw);
    const themes = Array.isArray(data?.themes)
      ? data.themes
          .map((t: { name?: unknown; points?: unknown }) => ({
            name: String(t?.name ?? "").trim(),
            points: Array.isArray(t?.points)
              ? t.points.map((p: unknown) => String(p).trim()).filter(Boolean)
              : [],
          }))
          .filter(
            (t: { name: string; points: string[] }) =>
              t.name && t.points.length > 0
          )
      : [];
    if (themes.length === 0) return null;
    return { title: String(data?.title ?? "").trim() || "Lesson", themes };
  } catch {
    return null;
  }
}

async function distill(transcript: string): Promise<Takeaways | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DISTILL_MODEL,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: transcript.slice(0, 120000) },
      ],
    }),
  });
  if (!res.ok) {
    console.error("lesson distill error:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "";
  return parseTakeaways(raw);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let transcript: string;
  let lessonId: string;
  let kind: "lesson" | "practice";
  let summarize: boolean;
  try {
    const body = await req.json();
    transcript = String(body.transcript ?? "").trim();
    lessonId = String(body.lessonId ?? "");
    kind = body.kind === "practice" ? "practice" : "lesson";
    // The "Condense and summarize" choice, default on. Off = store as-is.
    summarize = body.summarize !== false;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Retry path: re-distill an existing failed row (RLS scopes the read).
  if (lessonId) {
    const { data: row } = await supabase
      .from("lessons")
      .select("id, transcript")
      .eq("id", lessonId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    transcript = row.transcript;
  } else {
    if (!transcript || transcript.length > 200000) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    // Store as-is when the writer opted out of condensing, or when the
    // text is short enough to carry itself.
    const plain = !summarize || transcript.length < MIN_DISTILL_CHARS;
    const { data: created, error } = await supabase
      .from("lessons")
      .insert({
        user_id: user.id,
        transcript,
        kind,
        status: plain ? "ready" : "queued",
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("lesson insert error:", error);
      return NextResponse.json(
        { error: "Couldn't save it. Try again." },
        { status: 500 }
      );
    }
    lessonId = created.id;
    if (plain) {
      return NextResponse.json({ id: lessonId, status: "ready" });
    }
  }

  const takeaways = await distill(transcript).catch((e) => {
    console.error("lesson distill threw:", e);
    return null;
  });
  const status = takeaways ? "ready" : "failed";
  await supabase
    .from("lessons")
    .update({ takeaways, status })
    .eq("id", lessonId);
  return NextResponse.json({ id: lessonId, status, takeaways });
}
