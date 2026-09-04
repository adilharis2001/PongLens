import { NextResponse } from "next/server";

import { deliverIosBetaRequest } from "@/lib/email/iosBetaEmails";
import { claimIosBetaRequest } from "@/lib/iosBeta/claim";
import { handleIosBetaRequest } from "@/lib/iosBeta/request";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleIosBetaRequest(request, {
      testFlightUrl: process.env.IOS_TESTFLIGHT_URL,
      serviceSecret: process.env.SUPABASE_SERVICE_ROLE_KEY,
      claim: claimIosBetaRequest,
      deliver: deliverIosBetaRequest,
    });
  } catch (error) {
    console.error("iOS beta route failed:", error);
    return NextResponse.json(
      { ok: false, code: "temporarily_unavailable" },
      { status: 503 },
    );
  }
}
