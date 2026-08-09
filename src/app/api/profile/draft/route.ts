import { NextResponse } from "next/server";

import { createHash } from "node:crypto";

import { openAIUsageEvents, recordUsage } from "@/lib/costs/meter";
import { scrub } from "@/lib/reviews/scrub";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/profile/draft — a coach page written from one answer.
 *
 *   { brief }  ->  { headline, credentials, bio, sections }
 *
 * The same idea as the offering drafter and for the same reason: a coach
 * who has just fought their way through Stripe should not then face four
 * empty boxes and a blinking cursor. They say who they are, once, and get
 * a page to edit.
 *
 * IT NEVER TOUCHES THEIR NAME. Everything else is wording the coach can
 * argue with; their name is not wording. It is also the one field where
 * getting clever would be plainly wrong.
 *
 * NOTHING IS SAVED HERE. The answer fills the form the coach is looking
 * at, and their own Save button is still the only thing that writes.
 */

const MODEL = "gpt-5.6-luna";

const PER_USER_PER_HOUR = 10;
const PER_USER_PER_DAY = 30;
const BRIEF_CHARS = 2000;

/** Mirrors the coach_profiles constraints, so nothing bounces on save. */
const HEADLINE_CHARS = 120;
const BIO_CHARS = 2000;
const CRED_MAX = 8;
const SECTION_MAX = 6;

interface Drafted {
  headline: string;
  credentials: string[];
  bio: string;
  sections: { title: string; body: string }[];
}

const SYSTEM = `You write the profile page of a table tennis coach who sells reviews of recorded matches on PongLens. Players read this page and then decide whether to pay them.

WHAT YOU FILL IN.
- headline: one line under their name. What they are and who they are for. At most ${HEADLINE_CHARS} characters, no full stop needed.
- credentials: short factual chips, at most ${CRED_MAX}. "Level 2 coach", "National league, twelve years", "Coached at Ormesby". Each under 60 characters. Only things the coach actually told you.
- bio: a few short paragraphs in first person about how they coach and who they are good for. Two hundred to four hundred words is plenty.
- sections: optional extra blocks with a title and a body, at most ${SECTION_MAX}, only when the coach mentioned something that does not belong in the bio. Equipment they play with, the club or league they run, how they got into coaching, who they are not the right coach for. Leave this empty rather than padding it.

VOICE. First person, plain, the way they would talk to a player at their club. Then delete anything that sounds like selling.
- Complete sentences. Vary the rhythm; three sentences with the same shape in a row is a tell.
- Never use the dash character as punctuation. Use a comma or a full stop.
- Never use the shape "it is not X, it is Y", or "not only X but also Y".
- No superlatives, no "passionate", "dedicated", "unlock", "transform", "take your game to the next level", "elevate", "journey", "world class".
- Do not open with "As a coach" or "With over X years". Do not close with a call to action.

WHAT YOU MAY NOT DO.
- Do not invent credentials, ratings, playing history, qualifications, clubs, results or years. You have never met this coach. If their own words do not contain it, it does not go on the page.
- Do not promise lessons, calls or anything in person. They sell reviews of recorded matches.
- Do not write their name anywhere; it already sits above the headline.
- Do not mention PongLens, and never mention artificial intelligence, models or automatic analysis.
- Write in English, in the coach's own register. If their words are simple, keep them simple.
- A four digit number like 1300 or 1700 is a playing rating, never an age. Write "around 1400" or "between 1300 and 1700", never "aged 1400".

Return JSON: {"headline":"","credentials":[],"bio":"","sections":[{"title":"","body":""}]}`;

const hashOf = (t: string) => createHash("sha256").update(t).digest("hex");

const clean = (v: unknown, cap: number): string =>
  scrub(String(v ?? "").trim()).slice(0, cap);

function coerce(raw: unknown): Drafted {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    headline: clean(o.headline, HEADLINE_CHARS).replace(/\n/g, " "),
    credentials: (Array.isArray(o.credentials) ? o.credentials : [])
      .map((c) => clean(c, 60).replace(/\n/g, " "))
      .filter(Boolean)
      .slice(0, CRED_MAX),
    bio: clean(o.bio, BIO_CHARS),
    sections: (Array.isArray(o.sections) ? o.sections : [])
      .map((s) => {
        const x = (s ?? {}) as Record<string, unknown>;
        return {
          title: clean(x.title, 60).replace(/\n/g, " "),
          body: clean(x.body, 600),
        };
      })
      .filter((s) => s.title && s.body)
      .slice(0, SECTION_MAX),
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

  let body: { brief?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  const brief = String(body.brief ?? "")
    .trim()
    .slice(0, BRIEF_CHARS);
  if (brief.length < 15) {
    return NextResponse.json({ code: "too_short" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("headline, bio, credentials")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ code: "not_a_coach" }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("profile/draft: OPENAI_API_KEY not configured");
    return NextResponse.json({ code: "unavailable" }, { status: 503 });
  }

  // Whatever they have already written is context, not something to
  // preserve: they pressed the button because it is not right yet.
  const existing = [
    profile.headline ? `Current headline: ${profile.headline}` : "",
    Array.isArray(profile.credentials) && profile.credentials.length
      ? `Current credentials: ${profile.credentials.join(", ")}`
      : "",
    profile.bio ? `Current about: ${profile.bio}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const payload = `${existing ? `${existing}\n\n` : ""}What they told me about themselves:\n${brief}`;

  const admin = createAdminClient();
  const now = Date.now();
  const hour = new Date(now - 3600_000).toISOString();
  const day = new Date(now - 24 * 3600_000).toISOString();
  const key = hashOf(payload);

  const { data: seen } = await admin
    .from("profile_draft_runs")
    .select("result")
    .eq("user_id", user.id)
    .eq("input_hash", key)
    .gte("created_at", day)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seen?.result) {
    return NextResponse.json({ ...seen.result, repeated: true });
  }

  const [{ count: perHour }, { count: perDay }] = await Promise.all([
    admin
      .from("profile_draft_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", hour),
    admin
      .from("profile_draft_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", day),
  ]);
  if ((perHour ?? 0) >= PER_USER_PER_HOUR || (perDay ?? 0) >= PER_USER_PER_DAY) {
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
        max_completion_tokens: 3000,
        messages: [
          { role: "system", content: SYSTEM },
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
        operation: "profile_draft",
        idempotencyKey: `openai:${String(data.id ?? crypto.randomUUID())}:profile`,
      }),
    );

    let parsed: unknown = {};
    try {
      parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    } catch {
      console.error("profile/draft: unparseable response");
    }
    const drafted = coerce(parsed);
    if (!drafted.headline && !drafted.bio) {
      return NextResponse.json({ code: "nothing_back" }, { status: 502 });
    }

    await admin.from("profile_draft_runs").insert({
      user_id: user.id,
      input_hash: key,
      result: drafted,
    });
    return NextResponse.json(drafted);
  } catch (e) {
    console.error("profile/draft:", e);
    return NextResponse.json({ code: "draft_failed" }, { status: 502 });
  }
}
