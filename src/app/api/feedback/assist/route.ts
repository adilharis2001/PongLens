import { NextResponse } from "next/server";
import { openAIUsageEvents, recordUsage } from "@/lib/costs/meter";
import { createClient } from "@/lib/supabase/server";
import { requireAiConsent } from "@/lib/consent";
import {
  TIDY_MODEL,
  TIDY_RESPONSE_SCHEMA,
  TIDY_SYSTEM_PROMPT,
  parseTidy,
  tidyUserMessage,
} from "@/lib/feedbackTidy";

export const runtime = "nodejs";

/**
 * POST /api/feedback/assist — one OpenAI call that tidies a freshly
 * inserted feedback item for the board: each separate request becomes its
 * own post with a short title and a one-sentence summary in clean English,
 * plus board/private routing, rarely a follow-up question, and an optional
 * "this already exists" pointer at an existing board item. The prompt and
 * the parser live in src/lib/feedbackTidy.ts.
 *
 * The item is ALREADY saved with defaults before this runs; everything here
 * is best-effort polish. Fail-open: any error returns { questions: [] } and
 * the item keeps its defaults. Runs as the signed-in owner — the rewrite and
 * any split go through the owner-only SECURITY DEFINER RPC
 * feedback_apply_parts. The author's own words stay on every part as its
 * body; only title, summary and type are written.
 *
 * It needs the account's AI consent, like every route that sends a
 * player's words to OpenAI. An account that never turned AI features on
 * (most of them, in September 2026) gets its post exactly as typed; that is
 * why the board filled with first-eight-word titles.
 */

const FAIL_OPEN = { questions: [], similar: null, visibility: "board" };

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const denied = await requireAiConsent(supabase, user.id);
  if (denied) return denied;

  let itemId = "";
  let sentBody = "";
  try {
    const json = await req.json();
    itemId = String(json?.itemId ?? "").trim();
    sentBody = String(json?.body ?? "").trim();
  } catch {
    /* fall through to validation */
  }
  if (!itemId) {
    return NextResponse.json({ error: "itemId required" }, { status: 400 });
  }

  // The text comes from the row, not the request. The iPhone app sent
  // only the id and this route demanded the body too, so it refused with
  // a 400 and no post made from the app was ever tidied: each kept its
  // first eight words as a title and was never checked against the
  // board (found 2026-09-16). The row is what gets polished, so the row
  // is the truth; a body in the request is only a fallback for a read
  // that fails.
  const { data: row } = await supabase
    .from("feedback_items")
    .select("title, body")
    .eq("id", itemId)
    .maybeSingle();
  const typed = String(row?.body ?? sentBody).trim();
  // Since 2026-09-22 the author types a title and details separately.
  // The model reads both; a title that is just the first words of the
  // details (the old single-box posts, and the iPhone before its update)
  // adds nothing and is left out.
  const rowTitle = String(row?.title ?? "").trim();
  const body =
    rowTitle && !typed.toLowerCase().startsWith(rowTitle.toLowerCase())
      ? `${rowTitle}\n\n${typed}`
      : typed;
  if (!body) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
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

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TIDY_MODEL,
        store: false,
        reasoning_effort: "low",
        max_completion_tokens: 4000,
        messages: [
          { role: "system", content: TIDY_SYSTEM_PROMPT },
          { role: "user", content: tidyUserMessage(body, known) },
        ],
        response_format: TIDY_RESPONSE_SCHEMA,
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    await recordUsage(openAIUsageEvents({
      usage: data.usage,
      model: TIDY_MODEL,
      operation: "feedback_triage",
      idempotencyKey: `openai:${String(
        data.id ?? crypto.randomUUID()
      )}:feedback`,
      subjectUserId: user.id,
    }));
    const tidy = parseTidy(
      JSON.parse(data?.choices?.[0]?.message?.content ?? "{}"),
      known.map((i) => i.id),
    );
    if (!tidy) return NextResponse.json(FAIL_OPEN);

    const { data: ids, error: applyError } = await supabase.rpc("feedback_apply_parts", {
      p_item: itemId,
      p_visibility: tidy.visibility,
      p_parts: tidy.parts,
    });
    if (applyError) {
      console.error("feedback/assist: apply failed:", applyError);
      return NextResponse.json(FAIL_OPEN);
    }
    const idList = (Array.isArray(ids) ? ids : [itemId]) as string[];
    const posts = tidy.parts.map((p, i) => ({ id: idList[i] ?? itemId, title: p.title }));
    const similar = known.find((i) => i.id === tidy.similarItemId) ?? null;

    return NextResponse.json({
      questions: tidy.questions,
      similar,
      visibility: tidy.visibility,
      posts,
    });
  } catch (e) {
    console.error("feedback/assist error:", e);
    return NextResponse.json(FAIL_OPEN);
  }
}
