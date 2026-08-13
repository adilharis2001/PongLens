#!/usr/bin/env node
/**
 * Coach discovery for the outreach pipeline (101).
 *
 * Instagram's own user search is the discovery engine, not Google. A probe
 * on 2026-08-12 measured ten Serper queries returning 93 results and 16
 * unique handles, several of them junk; one Instagram search returned 33
 * profiles that were essentially all real table tennis coaches, for nine
 * cents. Google's role here is nil, so it is not called.
 *
 * Instagram never hands over an email, not even with the paid about-section
 * add-on. Every address in the pipeline comes from following the link in
 * the bio, which is why enrichment is half this script.
 *
 *   node scripts/marketing/discover.mjs [--limit 40] [--dry-run] [--terms en]
 *
 * Credentials come from the login Keychain under account `openclaw`:
 * `apify-token` and `ponglens-service-role`.
 */

import { execFileSync } from "node:child_process";

import { detectLanguage } from "./language.mjs";

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const APIFY = "https://api.apify.com/v2";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = args.includes("--dry-run");
const LIMIT = Number(flag("limit", 40));
const TERM_SET = flag("terms", "en");

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

const APIFY_TOKEN = keychain("apify-token");
const SERVICE_KEY = keychain("ponglens-service-role");

/**
 * English first, because that is where the outreach starts, but the other
 * languages stay in the run: a German coach found today is a German coach
 * we do not have to find again in October. Language is recorded, not
 * filtered, and the page sorts English to the top.
 */
const TERMS = {
  en: [
    "table tennis coach",
    "ping pong coach",
    "table tennis academy",
    "table tennis training",
    "table tennis club coach",
    "table tennis lessons",
  ],
  eu: [
    "Tischtennis Trainer",
    "entraineur tennis de table",
    "entrenador tenis de mesa",
    "allenatore tennistavolo",
    "trener tenisa stolowego",
  ],
};

const SPORT =
  /table.?tennis|ping.?pong|tischtennis|tennis de table|tenis de mesa|tennistavolo|tenis sto[lł]owy|настольн|卓球|桌球|乒乓/i;
const COACH =
  /coach|coaching|trainer|treinador|entra[iî]neur|entrenador|allenatore|тренер|コーチ|教練|academy|akademi|lessons|instructor|training/i;

const TLD_COUNTRY = {
  uk: "GB", de: "DE", fr: "FR", es: "ES", pt: "PT", it: "IT", pl: "PL",
  nl: "NL", se: "SE", dk: "DK", no: "NO", be: "BE", at: "AT", ch: "CH",
  ie: "IE", au: "AU", nz: "NZ", ca: "CA", in: "IN", ng: "NG", hk: "HK",
  jp: "JP", sg: "SG", za: "ZA", us: "US",
};

const PLACES = [
  [/\b(usa|united states|america|new york|california|texas|chicago|los angeles|florida|seattle|boston|las vegas)\b/i, "US"],
  [/\b(uk|england|london|manchester|birmingham|leeds|britain|scotland|wales)\b/i, "GB"],
  [/\b(australia|sydney|melbourne|brisbane|perth)\b/i, "AU"],
  [/\b(canada|toronto|vancouver|montreal)\b/i, "CA"],
  [/\b(ireland|dublin)\b/i, "IE"],
  [/\b(new zealand|auckland)\b/i, "NZ"],
  [/\b(singapore)\b/i, "SG"],
  [/\b(india|mumbai|delhi|chennai|bengaluru|bangalore|pune)\b/i, "IN"],
  [/\b(germany|deutschland|berlin|münchen|munich|hamburg)\b/i, "DE"],
  [/\b(france|paris|lyon|marseille)\b/i, "FR"],
  [/\b(spain|españa|madrid|barcelona)\b/i, "ES"],
];

function detectCountry(text, urls) {
  for (const url of urls) {
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    const parts = host.split(".");
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    if (TLD_COUNTRY[tld] && !(tld === "us" && sld === "www")) {
      return TLD_COUNTRY[tld];
    }
    const wa = url.match(/wa\.me\/\+?(\d{1,3})/);
    if (wa) {
      const cc = wa[1];
      if (cc.startsWith("1")) return "US";
      if (cc.startsWith("44")) return "GB";
      if (cc.startsWith("49")) return "DE";
      if (cc.startsWith("61")) return "AU";
      if (cc.startsWith("91")) return "IN";
    }
  }
  for (const [re, code] of PLACES) if (re.test(text)) return code;
  return null;
}

function looksLikeCoach(profile) {
  const hay = [profile.username, profile.fullName, profile.biography]
    .filter(Boolean)
    .join(" ");
  if (!SPORT.test(hay)) return null;
  if (!COACH.test(hay)) return null;
  // "tennis coach" without "table" is a different sport entirely.
  if (/\btennis coach\b/i.test(hay) && !/table.?tennis|ping.?pong/i.test(hay)) {
    return null;
  }
  const bits = [];
  if (/academy|akademi|club|verein/i.test(hay)) bits.push("runs a club or academy");
  if (/lessons|book|dm for/i.test(hay)) bits.push("takes bookings");
  if (/national|olympic|pro|professional/i.test(hay)) bits.push("elite background");
  return bits.length ? bits.join(", ") : "coach in name and bio";
}

// ---------------------------------------------------------------------------
// Apify
// ---------------------------------------------------------------------------

async function apify(path, init = {}) {
  const res = await fetch(`${APIFY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${APIFY_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`apify ${path}: ${res.status}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Instagram user search. Returns profile details, one run per term. */
async function searchProfiles(term, limit) {
  const { data: run } = await apify("/acts/apify~instagram-scraper/runs", {
    method: "POST",
    body: JSON.stringify({
      search: term,
      searchType: "user",
      searchLimit: limit,
      resultsType: "details",
      resultsLimit: 1,
    }),
  });
  for (let i = 0; i < 60; i++) {
    const { data } = await apify(`/actor-runs/${run.id}`);
    if (data.status !== "RUNNING" && data.status !== "READY") {
      const items = await apify(`/actor-runs/${run.id}/dataset/items`);
      return { items, cost: Number(data.usageTotalUsd || 0) };
    }
    await sleep(10_000);
  }
  throw new Error(`apify run ${run.id} did not finish`);
}

// ---------------------------------------------------------------------------
// Enrichment: the link in the bio is the only road to an email.
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36";
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAIL_JUNK =
  /(sentry|wixpress|\.png|\.jpe?g|\.gif|\.webp|example\.|domain\.com|@2x|godaddy|squarespace|cloudflare|schema\.org)/i;

async function get(url, ms = 12_000) {
  const stop = AbortSignal.timeout(ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: stop });
    return { html: (await res.text()).slice(0, 400_000), url: res.url };
  } catch {
    return { html: "", url };
  }
}

function emailsIn(html) {
  return [...new Set(html.match(EMAIL_RE) || [])].filter(
    (e) => !EMAIL_JUNK.test(e) && e.length < 60,
  );
}

/** Link aggregators hold the real links one level down. */
function isAggregator(url) {
  return /linktr\.ee|beacons\.ai|bio\.link|linkin\.bio|allmylinks|solo\.to|campsite\.bio/i.test(
    url,
  );
}

async function channelsFor(profile) {
  const out = [];
  out.push({ kind: "instagram", value: profile.username, source: "profile" });

  const roots = [profile.externalUrl, ...(profile.externalUrls || []).map((u) => u?.url)]
    .filter(Boolean)
    .slice(0, 3);

  const toVisit = [];
  for (const url of roots) {
    const wa = url.match(/wa\.me\/\+?(\d[\d\s-]*)/);
    const tg = url.match(/t\.me\/([A-Za-z0-9_]+)/);
    const yt = /youtube\.com|youtu\.be/i.test(url);
    if (wa) out.push({ kind: "whatsapp", value: wa[1].replace(/\D/g, ""), source: "profile" });
    else if (tg) out.push({ kind: "telegram", value: tg[1], source: "profile" });
    else if (yt) out.push({ kind: "youtube", value: url, source: "profile" });
    else {
      out.push({ kind: "website", value: url, source: "profile" });
      toVisit.push(url);
    }
    if (isAggregator(url)) toVisit.push(url);
  }

  for (const url of toVisit.slice(0, 2)) {
    const { html, url: landed } = await get(url);
    if (!html) continue;

    if (isAggregator(url)) {
      // Pull the children out and treat them as first-class links.
      const kids = [...new Set(html.match(/https?:\/\/[^"'\\ <]{6,120}/g) || [])]
        .filter((u) => !isAggregator(u) && !/instagram\.com|cdn|\.(png|jpe?g|css|js|svg)/i.test(u))
        .slice(0, 6);
      for (const kid of kids) {
        const wa = kid.match(/wa\.me\/\+?(\d[\d\s-]*)/);
        const tg = kid.match(/t\.me\/([A-Za-z0-9_]+)/);
        if (wa) out.push({ kind: "whatsapp", value: wa[1].replace(/\D/g, ""), source: "bio_link" });
        else if (tg) out.push({ kind: "telegram", value: tg[1], source: "bio_link" });
        else if (/youtube\.com|youtu\.be/i.test(kid))
          out.push({ kind: "youtube", value: kid, source: "bio_link" });
        else if (/^mailto:/i.test(kid)) continue;
        else out.push({ kind: "website", value: kid, source: "bio_link" });
      }
    }

    let hits = emailsIn(html);
    if (!hits.length) {
      // One hop to the page a site actually puts its address on.
      let origin = "";
      try {
        origin = new URL(landed).origin;
      } catch {
        origin = "";
      }
      if (origin) {
        for (const path of ["/contact", "/kontakt", "/contact-us", "/impressum", "/about"]) {
          const page = await get(`${origin}${path}`, 8000);
          hits = emailsIn(page.html);
          if (hits.length) break;
        }
      }
    }
    for (const email of hits.slice(0, 2)) {
      out.push({ kind: "email", value: email.toLowerCase(), source: "bio_link" });
    }
  }

  // Dedupe on kind+value, keeping the first (most trustworthy) source.
  const seen = new Set();
  return out.filter((c) => {
    const key = `${c.kind}:${c.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Supabase (service role, so RLS is bypassed by design)
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
  const terms = TERMS[TERM_SET] ?? [...TERMS.en, ...TERMS.eu];
  console.log(`discover: ${terms.length} terms, up to ${LIMIT} profiles each`);

  const run = DRY
    ? { id: null }
    : (await rest("outreach_runs", {
        method: "POST",
        body: JSON.stringify({ agent: "discover", detail: { terms, limit: LIMIT } }),
      }))[0];

  let found = 0;
  let added = 0;
  let cost = 0;
  const seen = new Set();

  try {
    for (const term of terms) {
      const { items, cost: termCost } = await searchProfiles(term, LIMIT);
      cost += termCost;
      console.log(`\n"${term}" → ${items.length} profiles (\$${termCost.toFixed(4)})`);

      for (const profile of items) {
        if (!profile?.username) continue;
        const handle = profile.username.toLowerCase();
        if (seen.has(handle)) continue;
        seen.add(handle);
        found++;

        const fit = looksLikeCoach(profile);
        if (!fit) continue;

        const text = [profile.fullName, profile.biography].filter(Boolean).join(" ");
        const channels = await channelsFor(profile);
        const urls = channels
          .filter((c) => ["website", "youtube", "whatsapp"].includes(c.kind))
          .map((c) => (c.kind === "whatsapp" ? `https://wa.me/${c.value}` : c.value));
        const language = detectLanguage(text);
        const country = detectCountry(text, urls);
        const emails = channels.filter((c) => c.kind === "email").length;

        console.log(
          `  @${handle.padEnd(30)} ${String(profile.followersCount ?? 0).padStart(7)} ` +
            `${(language ?? "??").padEnd(3)} ${(country ?? "--").padEnd(3)} ` +
            `${channels.length} channels${emails ? `, ${emails} email` : ""}`,
        );
        if (DRY) continue;

        const [coach] = await rest("outreach_coaches?on_conflict=handle", {
          method: "POST",
          headers: { Prefer: "return=representation,resolution=merge-duplicates" },
          body: JSON.stringify({
            handle,
            full_name: profile.fullName || null,
            bio: profile.biography || null,
            followers: profile.followersCount ?? 0,
            language,
            country,
            english: language === "en",
            profile_url: profile.url || `https://www.instagram.com/${handle}`,
            avatar_url: profile.profilePicUrl || null,
            fit_note: fit,
            discovered_via: term,
          }),
        });
        added++;

        for (const channel of channels) {
          await rest("outreach_channels?on_conflict=coach_id,kind,value", {
            method: "POST",
            headers: { Prefer: "resolution=ignore-duplicates", "Content-Profile": "public" },
            body: JSON.stringify({ ...channel, coach_id: coach.id }),
          }).catch(() => {});
        }
      }
    }

    if (!DRY) {
      await rest(`outreach_runs?id=eq.${run.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "succeeded",
          found,
          added,
          cost_usd: cost.toFixed(4),
          finished_at: new Date().toISOString(),
        }),
      });
    }
    console.log(
      `\ndone: ${found} profiles seen, ${added} coaches written, \$${cost.toFixed(4)} spent`,
    );
  } catch (err) {
    if (!DRY && run.id) {
      await rest(`outreach_runs?id=eq.${run.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          found,
          added,
          cost_usd: cost.toFixed(4),
          error: String(err).slice(0, 500),
          finished_at: new Date().toISOString(),
        }),
      }).catch(() => {});
    }
    throw err;
  }
}

await main();
