export type ReconcileDependencies = {
  admin(): Promise<boolean>;
  reconcile(id: string): Promise<string | null>;
};
export async function handleBetaAdminReconcile(
  request: Request,
  dependencies: ReconcileDependencies,
): Promise<Response> {
  if (request.method !== "POST")
    return Response.json({ ok: false }, { status: 405 });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ ok: false }, { status: 403 });
  try {
    if (!(await dependencies.admin()))
      return Response.json({ ok: false }, { status: 403 });
    // Read a bounded body even if Content-Length is missing or misleading.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ ok: false }, { status: 400 });
    let body = "";
    let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        return Response.json({ ok: false }, { status: 400 });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    let ids: unknown;
    try {
      ids = JSON.parse(body).ids;
    } catch {
      return Response.json({ ok: false }, { status: 400 });
    }
    if (
      !Array.isArray(ids) ||
      ids.length > 10 ||
      ids.some(
        (id) =>
          typeof id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          ),
      )
    )
      return Response.json({ ok: false }, { status: 400 });
    const results = [];
    // At most ten requests per refresh, sequential to bound provider pressure.
    for (const id of [...new Set(ids as string[])]) {
      let status: string | null;
      try {
        status = await dependencies.reconcile(id);
      } catch {
        status = "unknown";
      }
      results.push({ id, status });
    }
    return Response.json({
      ok: results.every(
        (r) =>
          r.status &&
          !["unknown", "failed", "needs_attention"].includes(r.status),
      ),
      results,
    });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
