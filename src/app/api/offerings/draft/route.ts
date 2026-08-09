import { NextResponse } from "next/server";

import { createHash } from "node:crypto";

import { openAIUsageEvents, recordUsage } from "@/lib/costs/meter";
import { scrub } from "@/lib/reviews/scrub";
import { OFFERING_TEMPLATES, STOCK_IMAGES } from "@/lib/reviews/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/offerings/draft — offerings written from one sentence.
 *
 *   { brief, count: 1 | 3 }  ->  { drafts: [...] }
 *
 * A coach arrives with a Stripe account, a profile, and an empty shop.
 * Filling in ten fields before earning anything is where they leave, so
 * this turns whatever they can say about their coaching into drafts they
 * can edit. Three of them, because three tiers convert better than one
 * price and better than five: the buyer's decision goes from yes or no to
 * which one, without tipping into choice overload.
 *
 * DRAFTS, NOT DECISIONS. Nothing here writes an offering. Everything comes
 * back to the builder the coach already knows, one Create button each,
 * every word editable. This is somebody's storefront and their income; the
 * model gets to do the typing and none of the deciding.
 *
 * The model has never met this coach. It is given their own profile words
 * and their own brief and told, at length, to invent no credentials, no
 * results and no promises about them. It is choosing shape and wording for
 * claims the coach already made, nothing more.
 */

const MODEL = "gpt-5.6-luna";

/**
 * The limits. Drafting is cheap, roughly two tenths of a cent a run, but
 * cheap is not free and an endpoint with no ceiling is an invitation.
 */
const PER_COACH_PER_HOUR = 12;
const PER_COACH_PER_DAY = 40;
const BRIEF_CHARS = 2000;

/** Mirrors the offerings table's own constraints, so nothing bounces. */
const MIN_CENTS = 500;
const MAX_CENTS = 50000;
const TURNAROUNDS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30];

interface Drafted {
  title: string;
  description: string;
  includes: string[];
  price_cents: number;
  turnaround_days: number;
  followup_rounds: number;
  questions: string[];
  sections: string[];
  patterns: string[];
  image: string;
}

/**
 * The templates, compressed into worked examples. This is the single most
 * useful thing in the prompt: it teaches the house voice, the shape of an
 * includes line, and that patterns are named observations rather than
 * topic headings, all without a paragraph of instruction.
 */
function examples(): string {
  return OFFERING_TEMPLATES.filter((t) => t.key !== "custom")
    .map((t) =>
      [
        `TITLE: ${t.title}`,
        `DESCRIPTION: ${t.description}`,
        `INCLUDES: ${t.includes.join(" | ")}`,
        `PRICE: ${t.price_cents} cents, ${t.turnaround_days} days, ${t.followup_rounds} follow-up`,
        `QUESTIONS: ${t.intake_questions
          .map((q) => (q.optional ? `${q.label} (optional)` : q.label))
          .join(" | ")}`,
        `SECTIONS: ${t.review_sections.map((s) => s.label).join(" | ")}`,
        `PATTERNS: ${t.suggested_patterns.join(" | ")}`,
        `IMAGE: ${t.image}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function system(count: number): string {
  return `You write offerings for a table tennis coach on PongLens, where players buy a review of one recorded match.

WHAT A REVIEW IS MADE OF. Two things, and an offering describes both.
- PATTERNS. A pattern is one named observation with the points from the match that show it, so the player sees the habit instead of taking the coach's word for it. A pattern may also carry a voice note and a drawing on the frame where it happens. "The long serve always goes to the same corner" is a pattern. "Serve" is not: that is a topic.
- THE WRITE-UP. Sections the coach types into afterwards. The coach chooses the section headings; they are the shape of the argument, not the evidence.

There is also a turnaround in days, a number of follow-up questions the player may ask after delivery, and questions the player answers when they send their match.

WRITE ${count === 1 ? "ONE OFFERING" : `${count} OFFERINGS`}.${
    count === 1
      ? ""
      : ` They must be a ladder, not three versions of the same thing: something short and cheap for a player who has never bought a review, one main offering that is the coach's real work, and one that is either deeper or aimed at a specific problem. Prices should be clearly different.`
  }

VOICE. Write the way the coach would describe it to a player in a club, then delete anything that sounds like selling.
- Plain, complete sentences. Vary the rhythm; three sentences with the same shape in a row is a tell.
- Never use the dash character as punctuation. Use a comma or a full stop.
- Never use the shape "it is not X, it is Y", or "not only X but also Y".
- No superlatives, no "unlock", "transform", "take your game to the next level", "elevate", "dive deep", "comprehensive".
- Do not open with a summary of what you are doing or close with an offer to help further.

WHAT YOU MAY NOT DO.
- Do not invent credentials, ratings, playing history, coaching qualifications, results, or numbers of players coached. You have never met this coach. If their own words do not contain it, it does not go in.
- Do not promise anything the product cannot deliver: no live calls, no in-person sessions, no ongoing plans, no unlimited anything, no guaranteed improvement.
- Do not mention PongLens by name, and never mention artificial intelligence, models, or automatic analysis. The coach is the one doing the watching.

INCLUDES LINES describe what arrives, in countable terms. Good: "5 to 7 patterns, each with the points that show it", "a voice note on the pattern that matters most", "a drawing on the frames that need one", "a practice plan for the next two weeks". Bad: "detailed analysis", "expert feedback", "actionable insights".

QUESTIONS are answered by the player when they send their match, so ask only for what changes how the coach watches it. End a question with " (optional)" if it can be skipped.

PATTERNS are the coach's own reminders in the workspace, never shown to the player. Name the things this offering promises to go looking for.

NUMBERS. price_cents between ${MIN_CENTS} and ${MAX_CENTS}. turnaround_days one of ${TURNAROUNDS.join(", ")}. followup_rounds 0 to 3. At most 6 includes, 4 questions, 5 sections, 5 patterns.

IMAGE. Pick the closest of: ${STOCK_IMAGES.join(", ")}.

HERE ARE WORKED EXAMPLES IN THE RIGHT VOICE. Do not copy them; the coach's own words come first.

${examples()}

Return JSON: {"drafts":[{"title":"","description":"","includes":[],"price_cents":0,"turnaround_days":0,"followup_rounds":0,"questions":[],"sections":[],"patterns":[],"image":""}]}
Exactly ${count} in the array.`;
}

const hashOf = (t: string) => createHash("sha256").update(t).digest("hex");

const clean = (v: unknown, cap: number): string =>
  scrub(String(v ?? "").trim()).slice(0, cap);

const cleanList = (v: unknown, cap: number, len: number): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => clean(x, len))
    .filter(Boolean)
    .slice(0, cap);

/**
 * Everything the model returns is treated as a suggestion that has to earn
 * its place in a row the database would accept. A price outside the band,
 * a turnaround nobody offers, an image key that does not exist: clamped
 * here rather than bounced at insert, because the coach did not type it
 * and should never see an error about it.
 */
function coerce(raw: unknown): Drafted | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const title = clean(o.title, 80);
  if (!title) return null;
  const cents = Math.round(Number(o.price_cents));
  const days = Math.round(Number(o.turnaround_days));
  const image = String(o.image ?? "");
  return {
    title,
    description: clean(o.description, 1000),
    includes: cleanList(o.includes, 6, 120),
    price_cents: Number.isFinite(cents)
      ? Math.min(MAX_CENTS, Math.max(MIN_CENTS, cents))
      : 3000,
    turnaround_days: TURNAROUNDS.includes(days) ? days : 4,
    followup_rounds: [0, 1, 2, 3].includes(Math.round(Number(o.followup_rounds)))
      ? Math.round(Number(o.followup_rounds))
      : 1,
    questions: cleanList(o.questions, 4, 160),
    sections: cleanList(o.sections, 5, 60),
    patterns: cleanList(o.patterns, 5, 80),
    image: STOCK_IMAGES.includes(image) ? image : "stock:custom",
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: { brief?: string; count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  const brief = String(body.brief ?? "")
    .trim()
    .slice(0, BRIEF_CHARS);
  const count = body.count === 1 ? 1 : 3;
  if (brief.length < 15) {
    return NextResponse.json({ code: "too_short" }, { status: 400 });
  }

  // Only a coach drafts offerings, and their own profile is the context
  // that makes one sentence enough: they already answered the interview
  // when they set up their page.
  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("display_name, headline, bio, credentials")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ code: "not_a_coach" }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("offerings/draft: OPENAI_API_KEY not configured");
    return NextResponse.json({ code: "unavailable" }, { status: 503 });
  }

  const about = [
    profile.headline ? `Headline: ${profile.headline}` : "",
    profile.bio ? `About them: ${profile.bio}` : "",
    Array.isArray(profile.credentials) && profile.credentials.length
      ? `Credentials they list: ${profile.credentials.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const payload = `${about ? `${about}\n\n` : ""}What they want to offer:\n${brief}`;

  const admin = createAdminClient();
  const now = Date.now();
  const hour = new Date(now - 3600_000).toISOString();
  const day = new Date(now - 24 * 3600_000).toISOString();
  const key = hashOf(`${count}:${payload}`);

  // Same words as last time, same answer, no spend. Serving the stored
  // result rather than refusing, because a coach who reloads the page has
  // done nothing wrong and should still see their drafts.
  const { data: seen } = await admin
    .from("offering_draft_runs")
    .select("result")
    .eq("coach_id", user.id)
    .eq("input_hash", key)
    .gte("created_at", day)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seen?.result) {
    return NextResponse.json({ drafts: seen.result, repeated: true });
  }

  const [{ count: perHour }, { count: perDay }] = await Promise.all([
    admin
      .from("offering_draft_runs")
      .select("id", { count: "exact", head: true })
      .eq("coach_id", user.id)
      .gte("created_at", hour),
    admin
      .from("offering_draft_runs")
      .select("id", { count: "exact", head: true })
      .eq("coach_id", user.id)
      .gte("created_at", day),
  ]);
  if ((perHour ?? 0) >= PER_COACH_PER_HOUR || (perDay ?? 0) >= PER_COACH_PER_DAY) {
    return NextResponse.json({ code: "too_many" }, { status: 429 });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: 4000,
        messages: [
          { role: "system", content: system(count) },
          { role: "user", content: payload },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = await res.json();
    await recordUsage(
      openAIUsageEvents({
        usage: data.usage,
        model: MODEL,
        operation: "offering_draft",
        idempotencyKey: `openai:${String(data.id ?? crypto.randomUUID())}:draft`,
      }),
    );

    let parsed: { drafts?: unknown[] } = {};
    try {
      parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    } catch {
      console.error("offerings/draft: unparseable response");
    }
    const drafts = (Array.isArray(parsed.drafts) ? parsed.drafts : [])
      .map(coerce)
      .filter((d): d is Drafted => d !== null)
      .slice(0, count);
    if (drafts.length === 0) {
      return NextResponse.json({ code: "nothing_back" }, { status: 502 });
    }

    await admin.from("offering_draft_runs").insert({
      coach_id: user.id,
      input_hash: key,
      result: drafts,
    });
    return NextResponse.json({ drafts });
  } catch (e) {
    console.error("offerings/draft:", e);
    return NextResponse.json({ code: "draft_failed" }, { status: 502 });
  }
}
