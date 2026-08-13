#!/usr/bin/env node
/**
 * Country and entity enrichment for the outreach pipeline (105).
 *
 * The country is nearly always sitting in the bio already, just not in a
 * form a regex reads: a flag emoji, a pin with a district name, the club
 * they are head coach at, a phone country code. Of the first 72 rows only
 * 10 resolved from link TLDs alone.
 *
 * So: flag emoji first, because a regional-indicator pair decodes to an ISO
 * code with certainty and costs nothing. Everything left goes to one model
 * call per coach, which knows that Al Khuwair is Oman and Jaipur is India
 * without a geocoding lookup. Google Places was considered and is the wrong
 * tool, because the input is unstructured text rather than a place name.
 *
 * The same call decides coach or club, since it has already read the bio and
 * follower count does not separate them (medians came out 361 for clubs and
 * 558 for coaches).
 *
 *   node scripts/marketing/enrich.mjs [--limit 100] [--all] [--dry-run]
 *
 * By default only rows never enriched are touched. --all re-runs everything.
 */

import { execFileSync } from "node:child_process";

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const MODEL = "gpt-5.6-luna";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = args.includes("--dry-run");
const ALL = args.includes("--all");
const LIMIT = Number(flag("limit", 200));

function keychain(service) {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-a", "openclaw", "-s", service, "-w"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    throw new Error(`missing Keychain secret: openclaw/${service}`);
  }
}

const SERVICE_KEY = keychain("ponglens-service-role");
const OPENAI_KEY = keychain("openai-api-key");

// ---------------------------------------------------------------------------
// Free signals, tried before spending anything
// ---------------------------------------------------------------------------

/**
 * A flag emoji is two regional indicator symbols, which map back to the two
 * ASCII letters of an ISO country code. This is the one country signal that
 * is not a guess, so it wins over everything else.
 */
function countryFromFlag(text) {
  if (!text) return null;
  const pair = [...text].filter(
    (ch) => ch.codePointAt(0) >= 0x1f1e6 && ch.codePointAt(0) <= 0x1f1ff,
  );
  if (pair.length < 2) return null;
  const letters = pair
    .slice(0, 2)
    .map((ch) => String.fromCharCode(ch.codePointAt(0) - 0x1f1e6 + 65))
    .join("");
  return /^[A-Z]{2}$/.test(letters) ? letters : null;
}

const TLD_COUNTRY = {
  uk: "GB", de: "DE", fr: "FR", es: "ES", pt: "PT", it: "IT", pl: "PL",
  nl: "NL", se: "SE", dk: "DK", no: "NO", be: "BE", at: "AT", ch: "CH",
  ie: "IE", au: "AU", nz: "NZ", ca: "CA", in: "IN", ng: "NG", hk: "HK",
  jp: "JP", sg: "SG", za: "ZA", cz: "CZ", ro: "RO", gr: "GR", fi: "FI",
};

function countryFromLinks(channels) {
  for (const channel of channels) {
    if (!["website", "youtube"].includes(channel.kind)) continue;
    let host = "";
    try {
      host = new URL(
        channel.value.startsWith("http") ? channel.value : `https://${channel.value}`,
      ).hostname;
    } catch {
      continue;
    }
    const tld = host.split(".").pop();
    if (TLD_COUNTRY[tld]) return TLD_COUNTRY[tld];
  }
  return null;
}

const PHONE_COUNTRY = [
  ["1", "US"], ["44", "GB"], ["49", "DE"], ["33", "FR"], ["34", "ES"],
  ["39", "IT"], ["48", "PL"], ["61", "AU"], ["64", "NZ"], ["91", "IN"],
  ["971", "AE"], ["351", "PT"], ["31", "NL"], ["46", "SE"], ["55", "BR"],
];

function countryFromPhone(channels) {
  for (const channel of channels) {
    if (channel.kind !== "whatsapp" && channel.kind !== "phone") continue;
    const digits = channel.value.replace(/\D/g, "");
    // Longest prefix first, so 971 beats 9 and 44 beats 4.
    const hit = [...PHONE_COUNTRY]
      .sort((a, b) => b[0].length - a[0].length)
      .find(([prefix]) => digits.startsWith(prefix));
    if (hit) return hit[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// The model pass, for everything the free signals could not answer
// ---------------------------------------------------------------------------

const SYSTEM = `You identify table tennis coaches and clubs from their Instagram profile.

Given a profile, answer three things:

1. country: the ISO 3166-1 alpha-2 code of the country this person or
   organisation is based in. Use every clue: city and district names, the
   language of the bio, national team mentions, the club they coach at,
   phone country codes, currency, the domain of their website. A district
   name like "Al Khuwair" is enough to place someone in Oman. Return null
   only when there is genuinely nothing to go on. Do not guess from language
   alone when the language is spoken in several countries, unless there is a
   second clue.

2. entity_type: "club" if this account represents an organisation, academy,
   centre, training centre or team that has a venue and multiple coaches.
   "coach" if it represents one person who coaches. An account named after a
   person is almost always a coach even if they founded a club. Follower
   count means nothing here.

3. confidence: 0 to 1, how sure you are of the country specifically.

Answer with JSON only, no prose: {"country": "US", "entity_type": "coach", "confidence": 0.8}
Use null for country when unknown, and lower confidence honestly.`;

async function askModel(coach, channels) {
  const links = channels
    .filter((c) => ["website", "youtube", "whatsapp", "telegram"].includes(c.kind))
    .map((c) => `${c.kind}: ${c.value}`)
    .join("\n");
  const profile = [
    `handle: ${coach.handle}`,
    `name: ${coach.full_name || "(none)"}`,
    `bio: ${coach.bio || "(none)"}`,
    `followers: ${coach.followers}`,
    links ? `links:\n${links}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: profile },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  const raw = body.choices?.[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const country =
    typeof parsed.country === "string" && /^[A-Za-z]{2}$/.test(parsed.country)
      ? parsed.country.toUpperCase()
      : null;
  const entity =
    parsed.entity_type === "club" || parsed.entity_type === "coach"
      ? parsed.entity_type
      : "unknown";
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : null;
  return { country, entity, confidence };
}

// ---------------------------------------------------------------------------

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const filter = ALL ? "" : "&enriched_at=is.null";
  const coaches = await rest(
    `outreach_coaches?select=id,handle,full_name,bio,followers,country,outreach_channels(kind,value)` +
      `&order=followers.desc&limit=${LIMIT}${filter}`,
  );
  console.log(`enrich: ${coaches.length} coaches${ALL ? " (all)" : " (never enriched)"}`);

  const run = DRY
    ? { id: null }
    : (await rest("outreach_runs", {
        method: "POST",
        body: JSON.stringify({ agent: "enrich", detail: { count: coaches.length } }),
      }))[0];

  let free = 0;
  let asked = 0;
  let resolved = 0;
  let clubs = 0;

  try {
    for (const coach of coaches) {
      const channels = coach.outreach_channels ?? [];
      const text = `${coach.full_name || ""} ${coach.bio || ""}`;

      let country = countryFromFlag(text);
      let source = country ? "flag" : null;
      let confidence = country ? 1 : null;
      if (!country) {
        country = countryFromLinks(channels);
        source = country ? "tld" : null;
        confidence = country ? 0.9 : null;
      }
      if (!country) {
        country = countryFromPhone(channels);
        source = country ? "phone" : null;
        confidence = country ? 0.85 : null;
      }
      if (country) free++;

      // The model still runs when a free signal answered the country,
      // because it is also the only thing deciding coach or club.
      let entity = "unknown";
      const answer = await askModel(coach, channels).catch((e) => {
        console.log(`  @${coach.handle}: model failed, ${String(e).slice(0, 80)}`);
        return null;
      });
      if (answer) {
        asked++;
        entity = answer.entity;
        if (!country && answer.country) {
          country = answer.country;
          source = "model";
          confidence = answer.confidence ?? 0.5;
        }
      }
      if (country) resolved++;
      if (entity === "club") clubs++;

      console.log(
        `  @${coach.handle.padEnd(30)} ${(country ?? "--").padEnd(3)} ` +
          `${(source ?? "-").padEnd(6)} ${entity}`,
      );
      if (DRY) continue;

      await rest(`outreach_coaches?id=eq.${coach.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          country,
          country_source: source,
          country_confidence: confidence,
          entity_type: entity,
          enriched_at: new Date().toISOString(),
        }),
      });
    }

    if (!DRY) {
      await rest(`outreach_runs?id=eq.${run.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "succeeded",
          found: coaches.length,
          added: resolved,
          detail: { free, asked, clubs },
          finished_at: new Date().toISOString(),
        }),
      });
    }
    console.log(
      `\ndone: ${resolved}/${coaches.length} countries known ` +
        `(${free} without asking), ${clubs} clubs`,
    );
  } catch (err) {
    if (!DRY && run.id) {
      await rest(`outreach_runs?id=eq.${run.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          error: String(err).slice(0, 500),
          finished_at: new Date().toISOString(),
        }),
      }).catch(() => {});
    }
    throw err;
  }
}

await main();
