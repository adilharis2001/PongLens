import { NextResponse } from "next/server";

import {
  fetchOpenAIKeyCosts,
  LOOKBACK_DAYS,
} from "@/lib/costs/providerKeyCosts";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/openai-key-costs — Vercel cron (see vercel.json), daily.
 *
 * Records what OpenAI says each API key spent, which is the only reading
 * that can separate research from production: our own ledger records the
 * code that made a call and never the credential it used. It is also the
 * only reading that sees spend the meter never recorded at all.
 *
 * This lives in a cron route rather than beside the rest of provider
 * reconciliation in the worker, because the worker runs from a sealed
 * release and anything added there does nothing until the next one is cut.
 * This needs only an admin key and a database.
 *
 * Missing configuration is not an error. The key is optional and the
 * dashboard already reports when this last ran, so a silent no-op shows up
 * as stale data on the page rather than as a red cron.
 */

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ code: "not_allowed" }, { status: 401 });
  }

  const adminKey = process.env.OPENAI_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json({ skipped: "OPENAI_ADMIN_KEY not configured" });
  }

  const startTime = Math.floor(
    (Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000) / 1000,
  );

  let rows;
  try {
    rows = await fetchOpenAIKeyCosts({ adminKey, startTime });
  } catch (error) {
    // Status only. A provider error body can echo request material.
    console.error(
      "openai-key-costs: fetch failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json({ code: "unavailable" }, { status: 503 });
  }

  if (rows.length === 0) return NextResponse.json({ recorded: 0 });

  const admin = createAdminClient();
  const { error } = await admin.rpc("record_provider_key_costs", {
    p_rows: rows.slice(0, 500),
  });
  if (error) {
    console.error("openai-key-costs: write failed:", error.message);
    return NextResponse.json({ code: "unavailable" }, { status: 503 });
  }
  return NextResponse.json({ recorded: rows.length });
}
