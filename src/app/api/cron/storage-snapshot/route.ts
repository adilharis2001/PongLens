import { NextResponse } from "next/server";

import { isAdminEmail } from "@/lib/config";
import { listObjects, MEDIA_BUCKET, RAW_BUCKET } from "@/lib/r2";
import {
  reelReferences,
  retiredMediaKeys,
  summarize,
  type BucketObject,
  type RetiredVersion,
  type UnattributedSample,
} from "@/lib/storage/inventory";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The nightly storage measurement.
 *
 * Lists both buckets, attributes every object to the account that stored
 * it (see lib/storage/inventory.ts), and writes one storage_snapshots row
 * per account. From then on an account's used space is that snapshot plus
 * whatever the ledger has booked since, so the running tally only has to
 * be right for the last day and the difference between the two is visible
 * on the admin storage page.
 *
 * GET  — Vercel cron (vercel.json), guarded by CRON_SECRET as a bearer.
 * POST — the admin's "Measure now" button on /admin, same work.
 *
 * Whole account, every night, on purpose: 17,000 objects listed in ten
 * seconds when this was written, and a per-account listing would need the
 * job to know every prefix per account, which is the bookkeeping the
 * snapshot exists to stop trusting.
 */

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ code: "not_allowed" }, { status: 401 });
  }
  return measure();
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ code: "not_allowed" }, { status: 403 });
  }
  return measure();
}

/**
 * The owner of each match or tag a reel was cut from, in chunks. The two
 * tables name the column differently (matches.user_id, tags.owner_id).
 */
async function ownersOf(
  admin: ReturnType<typeof createAdminClient>,
  table: "matches" | "tags",
  ids: string[],
): Promise<Map<string, string>> {
  const column = table === "matches" ? "user_id" : "owner_id";
  const owners = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await admin
      .from(table)
      .select(`id, ${column}`)
      .in("id", ids.slice(i, i + 300));
    if (error) throw error;
    for (const row of (data ?? []) as Record<string, string | null>[]) {
      const owner = row[column];
      if (row.id && owner) owners.set(row.id.toLowerCase(), owner);
    }
  }
  return owners;
}

/**
 * The files of retired versions nobody uses: a cut the player replaced
 * with a re-cut of their own, or a re-cut of theirs that failed. Their
 * storage stopped counting when that happened (the ledger was uncounted
 * then), so the measurement must not count them back overnight; the
 * worker removes them 30 days on. Any failure here (before the migration,
 * say) returns nothing, and the measurement counts them as before.
 */
async function retiredKeys(
  admin: ReturnType<typeof createAdminClient>,
  objects: BucketObject[],
): Promise<Set<string>> {
  const { data, error } = await admin.rpc("retired_processing_versions");
  if (error || !Array.isArray(data) || data.length === 0) return new Set();
  const versions = data as RetiredVersion[];
  const candidates = retiredMediaKeys(objects, versions);
  const retiring = versions.map((v) => v.version_id);
  const inUse = new Set<string>();
  for (let i = 0; i < candidates.length; i += 500) {
    const { data: used, error: usedError } = await admin.rpc("media_keys_in_use", {
      p_keys: candidates.slice(i, i + 500).map((key) => `r2://ponglens-media/${key}`),
      p_retiring: retiring,
    });
    if (usedError) return new Set();
    for (const key of (used ?? []) as string[]) inUse.add(key);
  }
  return new Set(candidates.filter((key) => !inUse.has(`r2://ponglens-media/${key}`)));
}

async function measure() {
  const admin = createAdminClient();
  const startedAt = new Date();
  const { data: run } = await admin
    .from("storage_snapshot_runs")
    .insert({ started_at: startedAt.toISOString() })
    .select("id")
    .single();
  const runId = (run as { id: string } | null)?.id;

  try {
    const [raw, media, tallyRes] = await Promise.all([
      listObjects(RAW_BUCKET, "", { maxPages: 200 }),
      listObjects(MEDIA_BUCKET, "", { maxPages: 200 }),
      admin.rpc("_storage_ledger_totals"),
    ]);
    if (tallyRes.error) throw tallyRes.error;

    const objects: BucketObject[] = [
      ...raw.map((o) => ({ bucket: "ponglens-raw" as const, key: o.key, size: o.size })),
      ...media.map((o) => ({ bucket: "ponglens-media" as const, key: o.key, size: o.size })),
    ];
    const refs = reelReferences(objects);
    const [matchOwner, tagOwner] = await Promise.all([
      ownersOf(admin, "matches", refs.matchIds),
      ownersOf(admin, "tags", refs.tagIds),
    ]);
    const retired = await retiredKeys(admin, objects);
    const inventory = summarize(objects, { matchOwner, tagOwner }, 12, retired);

    // The tally's answer at the same moment, recorded beside the
    // measurement so the admin page can show how far the two have drifted.
    const tally = new Map<string, number>();
    for (const row of (tallyRes.data ?? []) as { user_id: string; bytes: number }[]) {
      tally.set(row.user_id, Number(row.bytes));
    }

    // Every account that stores something, plus every account the tally
    // or an earlier snapshot still names, so a number never goes stale
    // once the files behind it are gone.
    const { data: existing } = await admin.from("storage_snapshots").select("user_id");
    const ids = new Set<string>([
      ...inventory.accounts.keys(),
      ...tally.keys(),
      ...((existing ?? []) as { user_id: string }[]).map((r) => r.user_id),
    ]);
    const rows = [...ids].map((userId) => {
      const usage = inventory.accounts.get(userId);
      return {
        user_id: userId,
        bytes: usage?.bytes ?? 0,
        objects: usage?.objects ?? 0,
        breakdown: usage?.breakdown ?? {},
        ledger_bytes: tally.get(userId) ?? 0,
      };
    });

    const skipped: string[] = [];
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await admin.rpc("_record_storage_snapshots", {
        p_measured_at: startedAt.toISOString(),
        p_rows: rows.slice(i, i + 200),
      });
      if (error) throw error;
      for (const s of (data ?? []) as { skipped: string }[]) skipped.push(s.skipped);
    }

    // Files under an account that no longer exists are as unowned as a
    // prefix nobody registered; both belong on the admin page.
    const unattributed: UnattributedSample[] = [...inventory.unattributed];
    let unattributedBytes = inventory.unattributedBytes;
    let unattributedObjects = inventory.unattributedObjects;
    for (const userId of skipped) {
      const usage = inventory.accounts.get(userId);
      if (!usage) continue;
      unattributedBytes += usage.bytes;
      unattributedObjects += usage.objects;
      if (unattributed.length < 12) {
        unattributed.push({
          bucket: "ponglens-media",
          key: `<prefix>/${userId}/…`,
          size: usage.bytes,
          reason: "unknown_prefix",
        });
      }
    }

    const summary = {
      objects: inventory.totalObjects,
      bytes: inventory.totalBytes,
      accounts: rows.filter((r) => r.objects > 0).length,
      platform_bytes: inventory.platformBytes,
      // Replaced cuts waiting out their 30 days: stored, counted to nobody.
      retired: { objects: inventory.retiredObjects, bytes: inventory.retiredBytes },
      unattributed: {
        objects: unattributedObjects,
        bytes: unattributedBytes,
        samples: unattributed,
      },
      seconds: (Date.now() - startedAt.getTime()) / 1000,
    };
    if (runId) {
      await admin
        .from("storage_snapshot_runs")
        .update({
          finished_at: new Date().toISOString(),
          objects: summary.objects,
          bytes: summary.bytes,
          accounts: summary.accounts,
          platform_bytes: summary.platform_bytes,
          unattributed: summary.unattributed,
        })
        .eq("id", runId);
    }
    return NextResponse.json(summary);
  } catch (e) {
    console.error("storage-snapshot:", e);
    if (runId) {
      await admin
        .from("storage_snapshot_runs")
        .update({
          finished_at: new Date().toISOString(),
          error: String((e as Error)?.message ?? e).slice(0, 500),
        })
        .eq("id", runId);
    }
    return NextResponse.json({ code: "measure_failed" }, { status: 500 });
  }
}
