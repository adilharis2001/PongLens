import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/feedback/assist — one cheap OpenAI call that tidies a freshly
 * inserted feedback item: short title, type, board/private routing, up to
 * two follow-up questions (strongly biased toward zero), and an optional
 * "this already exists" pointer at an existing board item.
 *
 * The item is ALREADY saved with defaults before this runs; everything here
 * is best-effort polish. Fail-open: any error returns { questions: [] } and
 * the item keeps its defaults. Runs as the signed-in owner — the update
 * goes through the owner-only SECURITY DEFINER RPC feedback_apply_assist.
 */

const MODEL = "gpt-5-nano";

// Compact app context so the model can tell bugs from ideas from
// account/support issues (condensed from SPEC.md).
const APP_CONTEXT = `PongLens: match analysis for table tennis players. Users upload a match video (or import from YouTube) and get:
- a "pure play" cut with dead time removed (download from dashboard)
- the match broken into per-point clips with a vertical point timeline
- per-point notes (text + voice notes with transcription) and an optional scorecard ("who won this point / how it ended") with AI suggestions
- serve rotation banner ("Who served first?") determines who served each point
- optional placement maps showing where the ball landed
- coach sharing: invite a coach by link; coach sees matches and leaves coach notes
- public share links for a point or a match
- keep-score mode: live one-tap scoring over the cut video
- account page: storage quota bar, request more space, manage share links
Processing runs on a queue; an email arrives when the match is ready.`;

const SYSTEM_PROMPT = `You triage feedback for PongLens.

${APP_CONTEXT}

Given one piece of user feedback, return:
- title: a short label, 8 words max, plain language, no trailing period.
- type: "bug" (something broken/wrong), "idea" (new capability), "improvement" (existing thing should work better), or "private" (account, login, billing, support, quota, personal data, or anything personal).
- visibility: "board" for product feedback other users could upvote; "private" for account/support/personal issues, anything with personal details, or feedback that only makes sense for this one user.
- questions: follow-up questions for the author. Default is [] — if the feedback names a concrete thing to build or fix, return [], and NEVER ask about preferences, formats, or details you could decide yourself. Ask only when the report is too vague to act on at all (no hint of what part of the app or when), and then ask the single question whose answer most changes what gets built (max 2). Under 15 words each; never restate the feedback.
- similar_item_id: if (and only if) the feedback is clearly the same request as one of the existing board items provided, its id. Otherwise null. Related-but-different is null.`;

const VALID_TYPES = new Set(["bug", "idea", "improvement", "private"]);
const VALID_VIS = new Set(["board", "private"]);

const RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "feedback_assist",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        type: { type: "string", enum: ["bug", "idea", "improvement", "private"] },
        visibility: { type: "string", enum: ["board", "private"] },
        questions: { type: "array", items: { type: "string" } },
        similar_item_id: { type: ["string", "null"] },
      },
      required: ["title", "type", "visibility", "questions", "similar_item_id"],
    },
  },
} as const;

type AssistResult = {
  title: string;
  type: string;
  visibility: string;
  questions: string[];
  similar_item_id: string | null;
};

const FAIL_OPEN = { questions: [], similar: null, visibility: "board" };

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body = "";
  let itemId = "";
  try {
    const json = await req.json();
    body = String(json?.body ?? "").trim();
    itemId = String(json?.itemId ?? "").trim();
  } catch {
    /* fall through to validation */
  }
  if (!body || !itemId) {
    return NextResponse.json({ error: "body and itemId required" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("feedback/assist: OPENAI_API_KEY not configured");
    return NextResponse.json(FAIL_OPEN);
  }

  try {
    // Existing board items (for duplicate detection). RLS scopes this read.
    const { data: boardItems } = await supabase
      .from("feedback_items")
      .select("id, title")
      .eq("visibility", "board")
      .neq("id", itemId)
      .order("vote_count", { ascending: false })
      .limit(50);
    const known = (boardItems ?? []).map((i) => ({ id: i.id, title: i.title }));

    const userMsg = `Feedback:\n"""\n${body.slice(0, 4000)}\n"""\n\nExisting board items:\n${
      known.length
        ? known.map((i) => `- ${i.id}: ${i.title}`).join("\n")
        : "(none)"
    }`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "low",
        max_completion_tokens: 3000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        response_format: RESPONSE_SCHEMA,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const parsed = JSON.parse(
      data?.choices?.[0]?.message?.content ?? "{}"
    ) as AssistResult;

    const title = String(parsed.title ?? "").trim().slice(0, 120);
    const type = VALID_TYPES.has(parsed.type) ? parsed.type : "idea";
    const visibility = VALID_VIS.has(parsed.visibility)
      ? parsed.visibility
      : "board";
    const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, 2);
    // Only trust a similar id that was actually in the list we provided.
    const similar =
      known.find((i) => i.id === parsed.similar_item_id) ?? null;

    // Apply title/type/visibility server-side (owner-only definer RPC).
    const { error: applyError } = await supabase.rpc("feedback_apply_assist", {
      p_item: itemId,
      p_title: title || null,
      p_type: type,
      p_visibility: visibility,
    });
    if (applyError) {
      console.error("feedback/assist: apply failed:", applyError);
      return NextResponse.json(FAIL_OPEN);
    }

    return NextResponse.json({ questions, similar, visibility });
  } catch (e) {
    console.error("feedback/assist error:", e);
    return NextResponse.json(FAIL_OPEN);
  }
}
