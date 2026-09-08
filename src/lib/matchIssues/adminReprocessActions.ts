export type AdminVersionAction = "reprocess" | "publish" | "keep" | "close" | "restore";
type RpcResult = { data: unknown | null; error: { code?: string } | null };
export interface AdminVersionDependencies {
  authenticate(): Promise<{ userId: string; isAdmin: boolean } | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  loadDetail(id: string): Promise<RpcResult>;
  sendEmail(id: string): Promise<void>;
  reportError(message: string): void;
}
const functions = { reprocess: "admin_start_match_reprocess", publish: "admin_publish_match_version", keep: "admin_keep_current_match_version", close: "admin_close_match_issue", restore: "admin_restore_match_issue_version" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** No client identity, artifact path, trim, funding or release crosses this boundary. */
export async function handleAdminVersionAction(request: Request, issueId: string, action: AdminVersionAction, deps: AdminVersionDependencies): Promise<Response> {
  try {
    const actor = await deps.authenticate();
    if (!actor) return reply({ code: "unauthenticated" }, 401);
    if (!actor.isAdmin) return reply({ code: "forbidden" }, 403);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issueId)) return reply({ code: "invalid_request" }, 400);
    let input: unknown;
    try { input = await request.json(); } catch { return reply({ code: "invalid_request" }, 400); }
    const allowed = action === "reprocess" ? ["options", "internalNote"] : action === "restore" ? ["playerNote"] : ["playerNote", "internalNote"];
    if (!record(input) || Object.keys(input).some(key => !allowed.includes(key)) ||
      (input.internalNote !== undefined && (typeof input.internalNote !== "string" || input.internalNote.length > 4000))) return reply({ code: "invalid_request" }, 400);
    const args: Record<string, unknown> = { p_issue_id: issueId };
    if (action === "reprocess") {
      const options = input.options ?? {};
      if (!record(options) || Object.keys(options).some(key => !["strictness", "placement"].includes(key)) ||
        ("strictness" in options && (typeof options.strictness !== "string" || !["tight", "normal", "loose"].includes(options.strictness))) ||
        ("placement" in options && typeof options.placement !== "boolean")) return reply({ code: "invalid_request" }, 400);
      args.p_options = options;
    } else {
      if (typeof input.playerNote !== "string" || !input.playerNote.trim() || input.playerNote.length > 1000) return reply({ code: "invalid_request" }, 400);
      args.p_player_note = input.playerNote.trim();
    }
    if (action !== "restore") args.p_internal_note = ((input.internalNote as string | undefined) ?? "").trim();
    const saved = await deps.rpc(functions[action], args);
    if (saved.error) {
      if (saved.error.code === "42501") return reply({ code: "forbidden" }, 403);
      if (saved.error.code === "P0002") return reply({ code: "not_found" }, 404);
      if (saved.error.code === "23514") return reply({ code: "invalid_request" }, 400);
      if (saved.error.code === "P0001") {
        const current = await deps.loadDetail(issueId);
        if (!current.error && current.data) return reply({ code: "conflict", detail: current.data }, 409);
      }
      return reply({ code: "unavailable" }, 503);
    }
    if (!saved.data) return reply({ code: "unavailable" }, 503);
    if (action !== "reprocess") {
      try { await deps.sendEmail(issueId); } catch { deps.reportError("Match issue decision saved; email delivery will retry."); }
    }
    return reply({ detail: saved.data });
  } catch {
    deps.reportError("Match issue response unavailable; reload before retrying.");
    return reply({ code: "unavailable" }, 503);
  }
}
