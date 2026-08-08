import { NextResponse } from "next/server";

import { createHash } from "node:crypto";

import { openAIUsageEvents, recordUsage } from "@/lib/costs/meter";
import { scrub, tells } from "@/lib/reviews/scrub";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/reviews/assist — the coach's two write-up tools.
 *
 *   { orderId, action: "tidy" }   clean the coach's own words
 *   { orderId, action: "check" }  a checklist before delivering
 *
 * Both are the coach's, both are read-only against the order, and neither
 * writes anything: tidy hands the text back for the coach to accept or
 * undo in their own browser, check hands back booleans. Nothing reaches a
 * student without the coach pressing Deliver afterwards.
 *
 * TIDY IS NOT A WRITER. The model has never seen the match, so it has
 * nothing true to add and is told, at length, to add nothing. It fixes
 * grammar, turns raw bullets into sentences, and stops. Everything it
 * returns goes through scrub() before it is sent back, because prompting
 * against house style helps and does not hold.
 *
 * CHECK IS MOSTLY FREE. Whether a section is empty, whether a point is
 * linked, how many words there are: all of that is arithmetic and is done
 * on the client. Only "did they answer what the student asked" needs a
 * model, so only that is asked for.
 */

const MODEL = "gpt-5.6-luna";

/**
 * The limits.
 *
 * Nothing here is a UI convenience; the button also disables itself, but a
 * disabled button is a suggestion and this is the rule. A coach who reaches
 * these numbers is not writing a review.
 *
 * INPUT_CHARS is the important one for reliability rather than cost: the
 * write-up is truncated to it before the model ever sees it, so a coach who
 * pastes something enormous gets a tidy of the first part instead of a
 * request that fails validation or comes back as truncated JSON.
 */
const PER_COACH_PER_HOUR = 20;
const PER_ORDER_PER_DAY = 12;
const INPUT_CHARS = 12_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIDY_SYSTEM = `You clean up a table tennis coach's written match review. You are a copy editor, not a coach and not a writer.

The coach watched this match. You did not. You therefore have nothing to add about the play, and adding anything would be inventing it.

DO:
- Fix spelling, grammar and punctuation.
- Turn fragments and raw bullet points into complete sentences.
- Group related lines into short paragraphs, keeping the coach's order.
- Keep every technical term, player name, score and number exactly as written.

DO NOT:
- Add any observation, advice, drill, praise or conclusion that is not already in the text.
- Remove any point the coach made.
- Change their voice. If they write plainly, stay plain. If they are blunt, stay blunt.
- Inflate. Two honest sentences must not become a paragraph.
- Use the dash character as punctuation, ever. Use a comma or a full stop.
- Use the shape "it is not X, it is Y", or "not only X but also Y". Say the affirmative thing directly.
- Open with a summary of what you did, or close with an offer to help further.

Return JSON: {"sections":[{"key":"<the key you were given>","body":"<cleaned text>"}]}
Return every section you were given, in the same order. If a section is empty, return it empty.`;

const CHECK_SYSTEM = `You check whether a table tennis coach's written review answers what their student actually asked.

You are given the student's questions and the full text of the review. Judge only whether each question is addressed somewhere in the text. Be generous: a question is answered if the review speaks to it at all, even briefly and even in different words. You are not grading the coaching.

Return JSON: {"answered":[{"question":"<what they asked, restated in at most six words, lower case, no trailing punctuation>","covered":true|false}]}

The restatement is a checklist label, so it must be short. "their serve getting attacked", "the lefty with long pips", "third ball attack".`;

const hashOf = (text: string) =>
  createHash("sha256").update(text).digest("hex");

interface TidySection {
  key: string;
  body: string;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: { orderId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  const orderId = String(body.orderId ?? "");
  const action = body.action === "check" ? "check" : "tidy";
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ code: "bad_order" }, { status: 400 });
  }

  // The coach's own order, and only while it is theirs to write.
  const { data: order } = await supabase
    .from("review_orders")
    .select("id, coach_id, status, intake_answers")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.coach_id !== user.id) {
    return NextResponse.json({ code: "not_yours" }, { status: 403 });
  }
  if (order.status !== "in_review" && order.status !== "clarification") {
    return NextResponse.json({ code: "not_open" }, { status: 409 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("reviews/assist: OPENAI_API_KEY not configured");
    return NextResponse.json({ code: "unavailable" }, { status: 503 });
  }

  const { data: doc } = await supabase
    .from("review_documents")
    .select("sections")
    .eq("order_id", orderId)
    .maybeSingle();
  const sections = (doc?.sections ?? []) as {
    key: string;
    label: string;
    body: string;
  }[];
  const written = sections.filter((s) => s.body.trim());
  if (written.length === 0) {
    return NextResponse.json({ code: "nothing_written" }, { status: 409 });
  }

  // ---- the limits, before anything is spent --------------------------
  const admin = createAdminClient();
  const now = Date.now();
  const hourAgo = new Date(now - 3600_000).toISOString();
  const dayAgo = new Date(now - 24 * 3600_000).toISOString();

  const [{ count: coachHour }, { count: orderDay }] = await Promise.all([
    admin
      .from("review_assist_runs")
      .select("id", { count: "exact", head: true })
      .eq("coach_id", user.id)
      .gte("created_at", hourAgo),
    admin
      .from("review_assist_runs")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("action", action)
      .gte("created_at", dayAgo),
  ]);
  if ((coachHour ?? 0) >= PER_COACH_PER_HOUR) {
    return NextResponse.json({ code: "too_many" }, { status: 429 });
  }
  if ((orderDay ?? 0) >= PER_ORDER_PER_DAY) {
    return NextResponse.json({ code: "too_many_order" }, { status: 429 });
  }

  const call = async (system: string, userMsg: string, maxTokens: number) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) {
      throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = await res.json();
    await recordUsage(
      openAIUsageEvents({
        usage: data.usage,
        model: MODEL,
        operation: `review_${action}`,
        idempotencyKey: `openai:${String(data.id ?? crypto.randomUUID())}:${action}`,
      }),
    );
    await admin.from("review_assist_runs").insert({
      order_id: orderId,
      coach_id: user.id,
      action,
      input_hash: hashOf(userMsg),
    });
    try {
      return JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    } catch {
      // A truncated or malformed answer is not worth a 502: the caller
      // treats an empty object as "nothing changed", which is the honest
      // outcome and leaves the coach's text alone.
      console.error("reviews/assist: unparseable response");
      return {};
    }
  };

  /** Same text as last time means there is nothing to redo. */
  const unchangedSince = async (payload: string) => {
    const { data } = await admin
      .from("review_assist_runs")
      .select("input_hash")
      .eq("order_id", orderId)
      .eq("action", action)
      .gte("created_at", dayAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.input_hash === hashOf(payload);
  };

  try {
    if (action === "tidy") {
      const payload = written
        .map((s) => `### ${s.key} (${s.label})\n${s.body.trim()}`)
        .join("\n\n")
        .slice(0, INPUT_CHARS);
      if (await unchangedSince(payload)) {
        return NextResponse.json({ code: "unchanged" }, { status: 200 });
      }
      // Room to return everything sent plus punctuation, never less.
      const parsed = (await call(TIDY_SYSTEM, payload, 6000)) as {
        sections?: TidySection[];
      };
      const byKey = new Map(
        (Array.isArray(parsed.sections) ? parsed.sections : [])
          .filter((s) => s && typeof s.key === "string")
          .map((s) => [s.key, String(s.body ?? "")]),
      );

      // Only sections the coach actually wrote, only when something came
      // back, and always scrubbed. A key we did not send is discarded: the
      // model does not get to invent a section either.
      const out = written.map((s) => {
        const cleaned = scrub(String(byKey.get(s.key) ?? "").trim());
        const usable = cleaned.length > 0 && tells(cleaned).length === 0;
        return {
          key: s.key,
          label: s.label,
          before: s.body,
          after: usable ? cleaned : s.body,
          changed: usable && cleaned !== s.body,
        };
      });
      return NextResponse.json({ sections: out });
    }

    // check
    const answers = (order.intake_answers ?? []) as {
      label?: string;
      answer?: string;
    }[];
    const questions = answers
      .filter((a) => String(a.answer ?? "").trim())
      .map((a) => `${a.label}: ${a.answer}`);
    if (questions.length === 0) {
      return NextResponse.json({ answered: [] });
    }
    const reviewText = written
      .map((s) => `${s.label}\n${s.body.trim()}`)
      .join("\n\n");
    const checkPayload = `What the student asked for:\n${questions.join(
      "\n",
    )}\n\nThe review:\n"""\n${reviewText.slice(0, INPUT_CHARS)}\n"""`;
    if (await unchangedSince(checkPayload)) {
      return NextResponse.json({ code: "unchanged" }, { status: 200 });
    }
    const parsed = (await call(CHECK_SYSTEM, checkPayload, 1500)) as {
      answered?: { question?: string; covered?: boolean; where?: string }[];
    };
    const answered = (Array.isArray(parsed.answered) ? parsed.answered : [])
      .slice(0, 6)
      .map((a) => ({
        question: String(a.question ?? "").slice(0, 80),
        covered: a.covered === true,
      }))
      .filter((a) => a.question);
    return NextResponse.json({ answered });
  } catch (e) {
    console.error(`reviews/assist ${action}:`, e);
    return NextResponse.json({ code: "assist_failed" }, { status: 502 });
  }
}
