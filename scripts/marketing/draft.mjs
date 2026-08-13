#!/usr/bin/env node
/**
 * Writes the first message for every coach worth writing to.
 *
 * Deliberately not a model call. The copy is Adil's, stored in voice.mjs,
 * and the only thing that varies is the greeting and which ask goes on the
 * end. Four model-written drafts were rejected before that was settled, so
 * handing the wording back to a model now would undo the work.
 *
 * Scope is the part that matters: only coaches in a country Stripe can pay,
 * only in the US or Europe, and only ones nobody has written to. A draft
 * for a coach who cannot be paid is a draft that wastes a morning.
 *
 *   node scripts/marketing/draft.mjs [--limit 50] [--dry-run] [--all-regions]
 *
 * Nothing is sent. Drafts land in outreach_touches with status 'draft' and
 * wait for Adil to read them, edit them, and paste them himself.
 */

import { execFileSync } from "node:child_process";

import { draftMessage, voiceProblems } from "./voice.mjs";

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = args.includes("--dry-run");
const ALL_REGIONS = args.includes("--all-regions");
const LIMIT = Number(flag("limit", 50));

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
  // Stages before contact only. Anyone already written to has a real
  // history, and a fresh draft on top of it would be noise.
  const region = ALL_REGIONS ? "" : "&region=in.(us,europe)";
  const coaches = await rest(
    "outreach_coaches?select=id,handle,full_name,followers,entity_type,region," +
      "payments_supported,outreach_touches(id,direction,status)" +
      "&payments_supported=is.true" +
      "&stage=in.(found,qualified,ready,warming)" +
      `${region}&order=followers.desc&limit=${LIMIT}`,
  );

  const pending = coaches.filter(
    (c) => !(c.outreach_touches ?? []).some((t) => t.direction === "out"),
  );
  console.log(
    `draft: ${coaches.length} in scope, ${pending.length} without a message yet`,
  );

  const run = DRY
    ? { id: null }
    : (await rest("outreach_runs", {
        method: "POST",
        body: JSON.stringify({ agent: "draft", detail: { scope: pending.length } }),
      }))[0];

  let written = 0;
  let refused = 0;

  try {
    for (const coach of pending) {
      const body = draftMessage(coach);
      const problems = voiceProblems(body);
      if (problems.length) {
        // A draft that fails his own rules never reaches him. If this ever
        // fires, the template changed and the test should have caught it.
        refused++;
        console.log(`  @${coach.handle}: refused, ${problems.join("; ")}`);
        continue;
      }
      console.log(
        `  @${coach.handle.padEnd(30)} ${coach.entity_type.padEnd(5)} ` +
          `${coach.region.padEnd(6)} ${body.split(/\s+/).length} words`,
      );
      if (DRY) continue;

      await rest("outreach_touches", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          coach_id: coach.id,
          kind: "instagram",
          direction: "out",
          status: "draft",
          body,
        }),
      });
      written++;
    }

    if (!DRY) {
      await rest(`outreach_runs?id=eq.${run.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "succeeded",
          found: pending.length,
          added: written,
          detail: { refused },
          finished_at: new Date().toISOString(),
        }),
      });
    }
    console.log(
      `\ndone: ${written} drafts written${refused ? `, ${refused} refused` : ""}`,
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
