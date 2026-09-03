import { NextResponse } from "next/server";

import {
  productIdForPack,
  verifySignedTransaction,
} from "@/lib/payments/applePurchases";
import { fulfillApplePurchase } from "@/lib/payments/platformMoney";
import { mapRpcError } from "@/lib/reviews/rpcError";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/billing/iap — buying minutes or storage through Apple.
 *
 * The web sends people to Stripe; the iOS app cannot (App Store rule
 * 3.1.1), so the phone buys from Apple and lands here. Both end at the
 * same grant in the database, so a balance means one thing however it
 * was bought.
 *
 * Actions:
 *   start  { kind, packKey }        -> { purchaseId, productId }
 *   verify { signedTransaction }    -> { granted }
 *
 * The two-step shape exists so the pack is priced and snapshotted by the
 * server BEFORE Apple takes any money — create_platform_purchase reads
 * app_config and writes what was bought onto a pending row. The phone
 * then carries that row's id through Apple as appAccountToken, and it
 * comes back to us inside Apple's signature.
 *
 * What makes this safe, in the order an attacker would meet it:
 *
 *   1. The transaction must carry Apple's signature, chaining to Apple's
 *      root. A hand-made receipt fails here.
 *   2. The purchase id is read from the SIGNED payload, never from the
 *      request body, so the caller cannot aim a real receipt at a
 *      different row.
 *   3. The product Apple says was bought must be the product this pack
 *      maps to. Without this, buying the $4.99 pack and pointing it at a
 *      pending 600-minute row would work.
 *   4. The row must belong to the caller.
 *   5. The transaction id is claimed under a unique index, so the same
 *      receipt grants once and only once however many times it arrives.
 */

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  }

  // Read fresh, not through the cached config helper: this is a kill
  // switch, and a switch that takes an hour to move is not one.
  const { data: flag } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "iap_enabled")
    .maybeSingle();
  if ((flag?.value ?? "off").trim() !== "on") {
    return NextResponse.json({ code: "iap_disabled" }, { status: 403 });
  }

  const action = body.action === "verify" ? "verify" : "start";

  // ---------------------------------------------------------------- start
  if (action === "start") {
    const kind = typeof body.kind === "string" ? body.kind : "";
    const packKey = typeof body.packKey === "string" ? body.packKey : "";
    if (!kind || !packKey) {
      return NextResponse.json({ code: "invalid_input" }, { status: 400 });
    }
    // Same RPC the web checkout calls: it validates the pack against
    // config, snapshots its price and contents, and stamps the caller's
    // billing mode. Nothing about the pack is taken from the phone.
    const { data, error } = await supabase.rpc("create_platform_purchase", {
      p_kind: kind,
      p_pack_key: packKey,
    });
    if (error) {
      const { code, status } = mapRpcError(error);
      return NextResponse.json({ code }, { status });
    }
    const purchase = data as { purchase_id: string };
    return NextResponse.json({
      purchaseId: purchase.purchase_id,
      productId: productIdForPack(packKey),
    });
  }

  // --------------------------------------------------------------- verify
  const signedTransaction =
    typeof body.signedTransaction === "string" ? body.signedTransaction : "";
  if (!signedTransaction) {
    return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  }

  const verified = await verifySignedTransaction(signedTransaction);
  if (!verified) {
    // Not genuine, not ours, or signed by Xcode's local test certificate.
    return NextResponse.json({ code: "not_verified" }, { status: 400 });
  }
  if (!verified.purchaseId) {
    // A transaction with no appAccountToken cannot be tied to a pack, so
    // there is nothing safe to grant. Should not happen from our app.
    console.error(
      `iap: transaction ${verified.transactionId} has no appAccountToken`,
    );
    return NextResponse.json({ code: "unlinked_purchase" }, { status: 400 });
  }

  // The row is read as the caller, so RLS already limits this to their
  // own purchases; the explicit user check states the rule where it can
  // be read rather than leaving it to a policy elsewhere.
  const { data: purchase } = await supabase
    .from("platform_purchases")
    .select("id, user_id, pack_key, status")
    .eq("id", verified.purchaseId)
    .maybeSingle();
  if (!purchase || purchase.user_id !== user.id) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }

  // The check that stops a cheap pack paying for an expensive one.
  if (verified.productId !== productIdForPack(purchase.pack_key)) {
    console.error(
      `iap: product mismatch on ${purchase.id}: Apple says ` +
        `${verified.productId}, pack is ${purchase.pack_key}`,
    );
    return NextResponse.json({ code: "product_mismatch" }, { status: 400 });
  }

  const granted = await fulfillApplePurchase({
    purchaseId: purchase.id,
    transactionId: verified.transactionId,
  });

  // granted=false means it was already done — a retry, or the app asking
  // again after a crash. The phone should finish the transaction either
  // way, so this is a success answer, not an error.
  return NextResponse.json({ granted });
}
