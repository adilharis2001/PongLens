/**
 * Demo-data guard for captures that have to TOUCH the product.
 *
 * The Keep score chapter is only honest if the tutorial actually taps a
 * winner — and that writes to the live demo account. Worse, the big answer
 * pad TOGGLES (Player.tsx: tapping the winner it already shows clears it),
 * so "just tap the value that is already there" silently un-scores a point.
 *
 * So the capture brackets itself: snapshot every field Keep score can
 * change, record, then put back anything that moved. The restore runs in a
 * `finally`, so a crashed or interrupted capture still leaves the demo
 * account exactly as it found it.
 *
 * Only the demo account's own match is ever touched, and only fields listed
 * here — nothing is deleted, and no media is involved.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogChapter, chapterPaths } from "./course-paths.mjs";

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const GUARD_USAGE = "usage: SERVICE_KEY=... guard.mjs restore <player|coach> <chapter>";

export function parseGuardArgs(args) {
  if (args.length !== 3 || args[0] !== "restore") throw new Error(GUARD_USAGE);
  const [, course, slug] = args;
  try {
    catalogChapter(course, slug);
  } catch (error) {
    throw new Error(`${GUARD_USAGE}\n${error.message}`);
  }
  return { command: "restore", course, slug };
}

/** Everything Keep score (and its follow-ups) can write on a point. */
const POINT_FIELDS = [
  "confirmed_winner",
  "confirmed_how",
  "is_let",
  "starred",
  "deleted",
  "game_end_override",
  "server_override",
  "direction",
  "serve_spin",
  "serve_sidespin",
  "serve_length",
  "misread_kind",
  "loss_reasons",
  // 063: the owner flagging a map as wrong is a write like any other.
  "placement_flagged",
];

/** And on the match itself (the serve chip can set the first server). */
const MATCH_FIELDS = [
  "first_server",
  "first_server_source",
  "user_side",
  "placement_flagged",
];

const headers = (key) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
});

async function rest(key, url, init = {}) {
  const res = await fetch(`${SUPABASE}/rest/v1/${url}`, {
    ...init,
    headers: { ...headers(key), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function snapshot(key, matchId) {
  const points = await rest(
    key,
    `points?match_id=eq.${matchId}&select=id,${POINT_FIELDS.join(",")}`
  );
  const [match] = await rest(
    key,
    `matches?id=eq.${matchId}&select=id,${MATCH_FIELDS.join(",")}`
  );
  // Rows that EXIST now. Anything on this match that does not appear in
  // these lists afterwards was created by the capture (a staged note, a
  // tag applied on camera) and gets deleted on restore. Restoring columns
  // is not enough on its own — an insert has no previous value to put back.
  const notes = await rest(key, `notes?match_id=eq.${matchId}&select=id`);
  const pointIds = points.map((p) => p.id);
  const pointTags = pointIds.length
    ? await rest(
        key,
        `point_tags?select=point_id,tag_id&point_id=in.(${pointIds.join(",")})`
      )
    : [];
  // The owner's tag vocabulary too: a chapter about tags has to create one
  // to show it, and a leftover label pollutes every future match's picker.
  const owner = match?.user_id
    ? match.user_id
    : (await rest(key, `matches?id=eq.${matchId}&select=user_id`))[0]?.user_id;
  const tags = owner
    ? await rest(key, `tags?owner_id=eq.${owner}&select=id`)
    : [];
  return {
    matchId,
    owner,
    points,
    match,
    noteIds: notes.map((n) => n.id),
    pointTagKeys: pointTags.map((t) => `${t.point_id}:${t.tag_id}`),
    tagIds: tags.map((t) => t.id),
  };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Put back anything that moved. Returns the number of rows restored. */
export async function restore(key, snap) {
  const now = await snapshot(key, snap.matchId);
  const before = new Map(snap.points.map((p) => [p.id, p]));
  let restored = 0;

  for (const current of now.points) {
    const original = before.get(current.id);
    if (!original) continue;
    const diff = {};
    for (const f of POINT_FIELDS) {
      if (!same(current[f], original[f])) diff[f] = original[f];
    }
    if (Object.keys(diff).length === 0) continue;
    await rest(key, `points?id=eq.${current.id}`, {
      method: "PATCH",
      body: JSON.stringify(diff),
    });
    restored += 1;
    console.log(`  restored point ${current.id}: ${Object.keys(diff).join(", ")}`);
  }

  const matchDiff = {};
  for (const f of MATCH_FIELDS) {
    if (!same(now.match?.[f], snap.match?.[f])) matchDiff[f] = snap.match[f];
  }
  if (Object.keys(matchDiff).length > 0) {
    await rest(key, `matches?id=eq.${snap.matchId}`, {
      method: "PATCH",
      body: JSON.stringify(matchDiff),
    });
    restored += 1;
    console.log(`  restored match: ${Object.keys(matchDiff).join(", ")}`);
  }

  // Delete pass: rows that did not exist when we started.
  const notesBefore = new Set(snap.noteIds ?? []);
  for (const n of await rest(key, `notes?match_id=eq.${snap.matchId}&select=id`)) {
    if (notesBefore.has(n.id)) continue;
    await rest(key, `notes?id=eq.${n.id}`, { method: "DELETE" });
    restored += 1;
    console.log(`  removed note created during capture (${n.id.slice(0, 8)})`);
  }
  const tagsBefore = new Set(snap.pointTagKeys ?? []);
  const ids = now.points.map((p) => p.id);
  if (ids.length) {
    const links = await rest(
      key,
      `point_tags?select=point_id,tag_id&point_id=in.(${ids.join(",")})`
    );
    for (const t of links) {
      if (tagsBefore.has(`${t.point_id}:${t.tag_id}`)) continue;
      await rest(
        key,
        `point_tags?point_id=eq.${t.point_id}&tag_id=eq.${t.tag_id}`,
        { method: "DELETE" }
      );
      restored += 1;
      console.log("  removed tag applied during capture");
    }
  }

  if (snap.owner) {
    const tagsBeforeIds = new Set(snap.tagIds ?? []);
    for (const t of await rest(key, `tags?owner_id=eq.${snap.owner}&select=id,label`)) {
      if (tagsBeforeIds.has(t.id)) continue;
      await rest(key, `tags?id=eq.${t.id}`, { method: "DELETE" });
      restored += 1;
      console.log(`  removed tag created during capture ("${t.label}")`);
    }
  }

  console.log(
    restored === 0 ? "  demo data unchanged" : `  demo data restored (${restored} rows)`
  );
  return restored;
}

// Recovery path for a capture that was killed before its `finally` ran.
export async function runGuard(args) {
  const { course, slug } = parseGuardArgs(args);
  const paths = chapterPaths(DIR, course, slug);
  const { readFileSync } = await import("node:fs");
  const key = process.env.SERVICE_KEY;
  if (!key) throw new Error("SERVICE_KEY env var required");
  const saved = JSON.parse(readFileSync(paths.guard, "utf8"));
  for (const one of [].concat(saved)) await restore(key, one);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runGuard(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
