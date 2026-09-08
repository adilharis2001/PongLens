type RpcResult = { data: unknown | null; error: { code?: string } | null };
export interface AdminRefundDependencies {
  authenticate(): Promise<{ userId: string; isAdmin: boolean } | null>;
  refund(id: string, playerNote: string, internalNote: string): Promise<RpcResult>;
  loadDetail(id: string): Promise<RpcResult>;
  sendEmail(id: string): Promise<void>;
  reportError(message: string): void;
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The database locks the request and owns the amount and saved decision. */
export async function handleAdminRefund(request: Request, issueId: string, deps: AdminRefundDependencies): Promise<Response> {
  const actor = await deps.authenticate();
  if (!actor) return reply({ code: "unauthenticated" }, 401);
  if (!actor.isAdmin) return reply({ code: "forbidden" }, 403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issueId)) return reply({ code: "invalid_request" }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ code: "invalid_request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ code: "invalid_request" }, 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "playerNote" && key !== "internalNote") ||
    typeof input.playerNote !== "string" || !input.playerNote.trim() || input.playerNote.length > 1000 ||
    (input.internalNote !== undefined && (typeof input.internalNote !== "string" || input.internalNote.length > 4000))) {
    return reply({ code: "invalid_request" }, 400);
  }
  try {
    const saved = await deps.refund(issueId, input.playerNote.trim(), ((input.internalNote as string | undefined) ?? "").trim());
    if (saved.error) {
      if (saved.error.code === "42501") return reply({ code: "forbidden" }, 403);
      if (saved.error.code === "P0002") return reply({ code: "not_found" }, 404);
      if (saved.error.code === "P0001") {
        const current = await deps.loadDetail(issueId);
        if (!current.error && current.data) return reply({ code: "conflict", detail: current.data }, 409);
      }
      deps.reportError("Could not save match issue refund.");
      return reply({ code: "unavailable" }, 503);
    }
    if (!saved.data) return reply({ code: "unavailable" }, 503);
    try { await deps.sendEmail(issueId); } catch { deps.reportError("Match issue refund saved; email delivery will retry."); }
    return reply({ detail: saved.data });
  } catch {
    deps.reportError("Match issue refund response unavailable; reload before retrying.");
    return reply({ code: "unavailable" }, 503);
  }
}
