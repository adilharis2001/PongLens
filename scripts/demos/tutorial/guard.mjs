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
  // Keep score records the video playhead together with the winner. A
  // restored outcome without its original timestamp is not a restoration.
  "scored_at_cut_s",
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
  // Task 5 stages populated/cleared maps for three vetted tutorial points.
  "placement",
  // 063: the owner flagging a map as wrong is a write like any other.
  "placement_flagged",
];

/** And on the match itself (the serve chip can set the first server). */
const MATCH_FIELDS = [
  "first_server",
  "first_server_source",
  "user_side",
  // The player Original/placement-retry capture temporarily stages these
  // fields on one explicitly-owned demo match.
  "raw_path",
  "placement_status",
  "placement_failure_code",
  "placement_retry_count",
  "placement_retry_expires_at",
  "placement_retry_job_id",
  "placement_generation_job_id",
  "placement_mapped_points",
  "placement_flagged",
];

const PLAYER_POINT_FIELDS = ["id", "match_id", "placement", "deleted"];
const PLAYER_POINT_RESTORE_FIELDS = ["placement", "deleted"];
const PLAYER_NOTE_FIELDS = [
  "id",
  "match_id",
  "point_id",
  "author_id",
  "body",
  "audio_path",
  "image_path",
  "created_at",
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
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

const COACH_RESTORE_ORDER = [
  "review_attachments",
  "review_findings",
  "note_drawings",
  "notes",
  "coach_entry_links",
  "coach_entry_photos",
  "coach_entries",
  "coach_entry_lessons",
  "coach_student_invites",
  "review_orders",
  "offerings",
  "coach_students",
  "coach_profiles",
];

const rowKey = (row) => row.id ?? row.user_id ?? row.order_id;

function carriesMarker(value, marker) {
  if (typeof value === "string") return value.startsWith(marker);
  if (Array.isArray(value)) return value.some((item) => carriesMarker(item, marker));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => carriesMarker(item, marker));
  }
  return false;
}

/** Snapshot only rows the adapter has already scoped to the staged coach. */
export async function snapshotCoach(adapter, spec) {
  if (spec?.kind !== "coach" || !spec.ownerId || !spec.ownerEmail) {
    throw new Error("coach guard requires ownerId and ownerEmail");
  }
  if (!Array.isArray(spec.tables) || spec.tables.length === 0) {
    throw new Error("coach guard requires at least one table");
  }
  await adapter.verifyOwner(spec.ownerId, spec.ownerEmail);
  const rows = {};
  for (const table of spec.tables) {
    rows[table] = structuredClone(await adapter.list(table, spec));
  }
  return { kind: "coach", spec: structuredClone(spec), rows };
}

/** Restore changed fixture rows and remove newly-created marker rows. */
export async function restoreCoach(adapter, snap) {
  await adapter.verifyOwner(snap.spec.ownerId, snap.spec.ownerEmail);
  let restored = 0;
  const deleteOrder = [...snap.spec.tables].sort(
    (a, b) => COACH_RESTORE_ORDER.indexOf(a) - COACH_RESTORE_ORDER.indexOf(b),
  );
  // Children first: marker rows cannot hold a parent row in place.
  for (const table of deleteOrder) {
    const originalRows = snap.rows[table] ?? [];
    const original = new Map(originalRows.map((row) => [rowKey(row), row]));
    const current = await adapter.list(table, snap.spec);
    for (const row of current) {
      const key = rowKey(row);
      if (original.has(key) || !carriesMarker(row, snap.spec.marker)) continue;
      await adapter.delete(table, key, snap.spec);
      restored += 1;
    }
  }

  // Parents first: a pre-existing row deleted mid-capture can be reinserted
  // before a child snapshot that still refers to it.
  for (const table of [...deleteOrder].reverse()) {
    const current = await adapter.list(table, snap.spec);
    const now = new Map(current.map((row) => [rowKey(row), row]));
    for (const before of snap.rows[table] ?? []) {
      const key = rowKey(before);
      const row = now.get(key);
      if (!row) {
        await adapter.insert(table, structuredClone(before), snap.spec);
        restored += 1;
        continue;
      }
      if (same(row, before)) continue;
      await adapter.update(table, key, structuredClone(before), snap.spec);
      restored += 1;
    }
  }
  return restored;
}

/** The same finally boundary used by a real capture, injectable for tests. */
export async function withCoachGuard(adapter, spec, work) {
  const snap = await snapshotCoach(adapter, spec);
  try {
    return await work();
  } finally {
    await restoreCoach(adapter, snap);
  }
}

/** Snapshot the narrowly-vetted player state used by the live player audit. */
export async function snapshotPlayer(adapter, spec) {
  if (
    spec?.kind !== "player" ||
    !spec.ownerId ||
    !spec.ownerEmail ||
    !spec.matchId ||
    !Array.isArray(spec.pointIds) ||
    spec.pointIds.length === 0
  ) {
    throw new Error("player guard requires ownerId, ownerEmail, matchId, and pointIds");
  }
  const cleanupRawObjects = spec.cleanupRawObjects ?? [];
  const cleanupNotes = spec.cleanupNotes ?? [];
  for (const object of cleanupRawObjects) {
    if (
      object?.bucket !== "ponglens-raw" ||
      typeof object.key !== "string" ||
      !object.key.startsWith(`${spec.ownerId}/`)
    ) {
      throw new Error("player guard only cleans owned ponglens-raw objects");
    }
  }
  for (const marker of cleanupNotes) {
    if (
      marker?.matchId !== spec.matchId ||
      marker?.authorId !== spec.ownerId ||
      !spec.pointIds.includes(marker?.pointId) ||
      typeof marker?.body !== "string" ||
      marker.body.length === 0
    ) {
      throw new Error("player guard only accepts an owned tutorial note marker");
    }
  }

  await adapter.verifyOwner(spec.ownerId, spec.ownerEmail);
  const match = await adapter.getMatch(spec.matchId);
  if (!match || match.user_id !== spec.ownerId) {
    throw new Error("refusing to guard a match outside the staged tutorial owner");
  }
  const points = await adapter.getPoints(spec.matchId, spec.pointIds);
  const found = new Set(points.map((point) => point.id));
  if (
    points.some((point) => point.match_id !== spec.matchId) ||
    spec.pointIds.some((id) => !found.has(id))
  ) {
    throw new Error("refusing to guard points outside the staged tutorial match");
  }
  for (const object of cleanupRawObjects) {
    if (await adapter.objectExists(object)) {
      throw new Error("refusing to overwrite a pre-existing tutorial raw object");
    }
  }
  const notes = [];
  for (const marker of cleanupNotes) {
    const rows = await adapter.getNotes(marker);
    if (rows.some((row) =>
      row.match_id !== marker.matchId ||
      row.point_id !== marker.pointId ||
      row.author_id !== marker.authorId ||
      row.body !== marker.body
    )) {
      throw new Error("player guard note query escaped its owned tutorial marker");
    }
    notes.push({ marker: structuredClone(marker), rows: structuredClone(rows) });
  }
  return {
    kind: "player",
    spec: structuredClone(spec),
    match: structuredClone(match),
    points: structuredClone(points),
    notes,
  };
}

/** Restore staged player DB fields and always remove capture-created raw media. */
export async function restorePlayer(adapter, snap) {
  await adapter.verifyOwner(snap.spec.ownerId, snap.spec.ownerEmail);
  let restored = 0;
  try {
    const currentMatch = await adapter.getMatch(snap.spec.matchId);
    if (!currentMatch || currentMatch.user_id !== snap.spec.ownerId) {
      throw new Error("refusing to restore a match outside the staged tutorial owner");
    }
    const matchPatch = {};
    for (const field of MATCH_FIELDS) {
      if (!same(currentMatch[field], snap.match[field])) matchPatch[field] = snap.match[field];
    }
    if (Object.keys(matchPatch).length) {
      await adapter.updateMatch(snap.spec.matchId, matchPatch);
      restored += 1;
    }

    const currentPoints = await adapter.getPoints(snap.spec.matchId, snap.spec.pointIds);
    const currentById = new Map(currentPoints.map((point) => [point.id, point]));
    for (const original of snap.points) {
      const current = currentById.get(original.id);
      if (!current || current.match_id !== snap.spec.matchId) {
        throw new Error("a guarded tutorial point disappeared before restore");
      }
      const pointPatch = {};
      for (const field of PLAYER_POINT_RESTORE_FIELDS) {
        if (!same(current[field], original[field])) pointPatch[field] = original[field];
      }
      if (Object.keys(pointPatch).length === 0) continue;
      await adapter.updatePoint(original.id, pointPatch);
      restored += 1;
    }

    for (const saved of snap.notes ?? []) {
      const current = await adapter.getNotes(saved.marker);
      const originals = new Map(saved.rows.map((row) => [row.id, row]));
      const currentById = new Map(current.map((row) => [row.id, row]));
      for (const row of current) {
        if (originals.has(row.id)) continue;
        await adapter.deleteNote(row.id, saved.marker);
        restored += 1;
      }
      for (const original of saved.rows) {
        const row = currentById.get(original.id);
        if (!row) {
          await adapter.insertNote(structuredClone(original), saved.marker);
          restored += 1;
        } else if (!same(row, original)) {
          await adapter.updateNote(original.id, structuredClone(original), saved.marker);
          restored += 1;
        }
      }
    }
  } finally {
    for (const object of snap.spec.cleanupRawObjects ?? []) {
      if (!(await adapter.objectExists(object))) continue;
      await adapter.deleteObject(object);
      restored += 1;
    }
  }
  return restored;
}

/** The interruption-safe boundary Task 5 uses around reversible staging. */
export async function withPlayerGuard(adapter, spec, work) {
  const snap = await snapshotPlayer(adapter, spec);
  try {
    return await work();
  } finally {
    await restorePlayer(adapter, snap);
  }
}

const COACH_TABLES = {
  coach_students: { table: "coach_students", key: "id", filter: "coach_id" },
  coach_student_invites: {
    table: "coach_student_invites",
    key: "id",
    filter: "coach_id",
  },
  coach_entries: { table: "coach_entries", key: "id", filter: "coach_id" },
  coach_entry_lessons: {
    table: "lessons",
    key: "id",
    filter: "user_id",
    extra: "&kind=eq.coach",
  },
  coach_entry_links: {
    table: "share_links",
    key: "id",
    filter: "owner",
    extra: "&kind=eq.entry",
  },
  coach_entry_photos: {
    table: "lessons",
    key: "id",
    filter: "user_id",
    extra: "&kind=eq.coach&image_path=not.is.null",
  },
  notes: { table: "notes", key: "id", filter: "author_id" },
  note_drawings: {
    table: "notes",
    key: "id",
    filter: "author_id",
    extra: "&image_path=not.is.null",
  },
  coach_profiles: { table: "coach_profiles", key: "user_id", filter: "user_id" },
  offerings: { table: "offerings", key: "id", filter: "coach_id" },
  review_orders: { table: "review_orders", key: "id", filter: "coach_id" },
  review_findings: { table: "review_findings", key: "id", throughOrders: true },
  review_attachments: { table: "review_attachments", key: "id", throughOrders: true },
};

async function coachOrderIds(key, ownerId) {
  const rows = await rest(
    key,
    `review_orders?coach_id=eq.${ownerId}&select=id`,
  );
  return rows.map((row) => row.id);
}

/** Supabase implementation of the tested coach-guard adapter boundary. */
export function makeCoachGuardAdapter(key) {
  const config = (logical) => {
    const found = COACH_TABLES[logical];
    if (!found) throw new Error(`unsupported coach guard table: ${logical}`);
    return found;
  };
  const query = async (logical, spec) => {
    const table = config(logical);
    if (table.throughOrders) {
      const ids = await coachOrderIds(key, spec.ownerId);
      if (ids.length === 0) return [];
      return rest(key, `${table.table}?order_id=in.(${ids.join(",")})&select=*`);
    }
    return rest(
      key,
      `${table.table}?${table.filter}=eq.${spec.ownerId}${table.extra ?? ""}&select=*`,
    );
  };
  return {
    async verifyOwner(ownerId, expectedEmail) {
      const res = await fetch(`${SUPABASE}/auth/v1/admin/users/${ownerId}`, {
        headers: headers(key),
      });
      if (!res.ok) {
        throw new Error(`could not verify tutorial coach (${res.status})`);
      }
      const user = await res.json();
      if (user.email?.toLowerCase() !== expectedEmail.toLowerCase()) {
        throw new Error("refusing to guard a coach account that is not the staged tutorial owner");
      }
    },
    list: query,
    async update(logical, rowId, row) {
      const table = config(logical);
      const patch = { ...row };
      delete patch[table.key];
      await rest(key, `${table.table}?${table.key}=eq.${rowId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    async insert(logical, row) {
      const table = config(logical);
      await rest(key, table.table, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
    },
    async delete(logical, rowId) {
      const table = config(logical);
      await rest(key, `${table.table}?${table.key}=eq.${rowId}`, {
        method: "DELETE",
      });
    },
  };
}

const keychain = async (service) => {
  const { execFileSync } = await import("node:child_process");
  return execFileSync(
    "security",
    ["find-generic-password", "-a", "openclaw", "-s", service, "-w"],
    { encoding: "utf8" },
  ).trim();
};

async function rawObjectClient() {
  const { AwsClient } = await import("aws4fetch");
  const account = process.env.R2_ACCOUNT_ID ?? await keychain("ponglens-r2-account");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? await keychain("ponglens-r2-key-id");
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY ?? await keychain("ponglens-r2-secret");
  return {
    account,
    client: new AwsClient({ accessKeyId, secretAccessKey, region: "auto", service: "s3" }),
  };
}

function rawObjectUrl(account, object) {
  const encoded = object.key.split("/").map(encodeURIComponent).join("/");
  return `https://${account}.r2.cloudflarestorage.com/${object.bucket}/${encoded}`;
}

/** Supabase/R2 implementation of the tested player-guard adapter boundary. */
export function makePlayerGuardAdapter(key) {
  let objectClient;
  const r2 = async () => (objectClient ??= rawObjectClient());
  return {
    async verifyOwner(ownerId, expectedEmail) {
      const res = await fetch(`${SUPABASE}/auth/v1/admin/users/${ownerId}`, {
        headers: headers(key),
      });
      if (!res.ok) throw new Error(`could not verify tutorial player (${res.status})`);
      const user = await res.json();
      if (user.email?.toLowerCase() !== expectedEmail.toLowerCase()) {
        throw new Error("refusing to guard a player account that is not the staged tutorial owner");
      }
    },
    async getMatch(matchId) {
      const [match] = await rest(
        key,
        `matches?id=eq.${matchId}&select=id,user_id,${MATCH_FIELDS.join(",")}`,
      );
      return match;
    },
    async getPoints(matchId, pointIds) {
      return rest(
        key,
        `points?match_id=eq.${matchId}&id=in.(${pointIds.join(",")})&select=${PLAYER_POINT_FIELDS.join(",")}`,
      );
    },
    async updateMatch(matchId, patch) {
      await rest(key, `matches?id=eq.${matchId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    async updatePoint(pointId, patch) {
      await rest(key, `points?id=eq.${pointId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    async getNotes(marker) {
      const filters = new URLSearchParams({
        match_id: `eq.${marker.matchId}`,
        point_id: `eq.${marker.pointId}`,
        author_id: `eq.${marker.authorId}`,
        body: `eq.${marker.body}`,
        select: PLAYER_NOTE_FIELDS.join(","),
      });
      return rest(key, `notes?${filters}`);
    },
    async deleteNote(noteId, marker) {
      const filters = new URLSearchParams({
        id: `eq.${noteId}`,
        match_id: `eq.${marker.matchId}`,
        point_id: `eq.${marker.pointId}`,
        author_id: `eq.${marker.authorId}`,
        body: `eq.${marker.body}`,
      });
      await rest(key, `notes?${filters}`, { method: "DELETE" });
    },
    async insertNote(row, marker) {
      if (
        row.match_id !== marker.matchId ||
        row.point_id !== marker.pointId ||
        row.author_id !== marker.authorId ||
        row.body !== marker.body
      ) {
        throw new Error("refusing to restore a note outside its owned tutorial marker");
      }
      await rest(key, "notes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
    },
    async updateNote(noteId, row, marker) {
      if (
        row.id !== noteId ||
        row.match_id !== marker.matchId ||
        row.point_id !== marker.pointId ||
        row.author_id !== marker.authorId ||
        row.body !== marker.body
      ) {
        throw new Error("refusing to restore a note outside its owned tutorial marker");
      }
      const patch = { ...row };
      delete patch.id;
      const filters = new URLSearchParams({
        id: `eq.${noteId}`,
        match_id: `eq.${marker.matchId}`,
        point_id: `eq.${marker.pointId}`,
        author_id: `eq.${marker.authorId}`,
      });
      await rest(key, `notes?${filters}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    async objectExists(object) {
      const { account, client } = await r2();
      const response = await client.fetch(rawObjectUrl(account, object), { method: "HEAD" });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`R2 HEAD ${response.status} for guarded raw object`);
      return true;
    },
    async deleteObject(object) {
      const { account, client } = await r2();
      const response = await client.fetch(rawObjectUrl(account, object), { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new Error(`R2 DELETE ${response.status} for guarded raw object`);
      }
    },
  };
}

export async function snapshot(key, matchId, adapter) {
  if (matchId?.kind === "coach") {
    return snapshotCoach(adapter ?? makeCoachGuardAdapter(key), matchId);
  }
  if (matchId?.kind === "player") {
    return snapshotPlayer(adapter ?? makePlayerGuardAdapter(key), matchId);
  }
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

/** Exact legacy point patch used by Keep score and its recovery command. */
export function restoredPointPatch(current, original) {
  const patch = {};
  for (const field of POINT_FIELDS) {
    if (!same(current[field], original[field])) patch[field] = original[field];
  }
  return patch;
}

/** Put back anything that moved. Returns the number of rows restored. */
export async function restore(key, snap, adapter) {
  if (snap?.kind === "coach") {
    return restoreCoach(adapter ?? makeCoachGuardAdapter(key), snap);
  }
  if (snap?.kind === "player") {
    return restorePlayer(adapter ?? makePlayerGuardAdapter(key), snap);
  }
  const now = await snapshot(key, snap.matchId);
  const before = new Map(snap.points.map((p) => [p.id, p]));
  let restored = 0;

  for (const current of now.points) {
    const original = before.get(current.id);
    if (!original) continue;
    const diff = restoredPointPatch(current, original);
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
export async function runGuard(args, options = {}) {
  const { course, slug } = parseGuardArgs(args);
  const paths = chapterPaths(DIR, course, slug);
  const { readFileSync } = await import("node:fs");
  const key = options.key ?? process.env.SERVICE_KEY;
  if (!key) throw new Error("SERVICE_KEY env var required");
  const saved = JSON.parse(readFileSync(options.snapshotPath ?? paths.guard, "utf8"));
  for (const one of [].concat(saved)) await restore(key, one, options.adapter);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runGuard(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
