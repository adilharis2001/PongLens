import type { BetaDeliveryState } from "./delivery.ts";
export type BetaAdminDependencies = {
  admin(): Promise<{ id: string } | null>;
  send(id: string, actor: string): Promise<BetaDeliveryState | null>;
};
export async function handleBetaAdminSend(
  request: Request,
  id: string,
  dependencies: BetaAdminDependencies,
): Promise<Response> {
  if (request.method !== "POST")
    return Response.json({ ok: false }, { status: 405 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    return Response.json({ ok: false }, { status: 403 });
  try {
    const admin = await dependencies.admin();
    if (!admin) return Response.json({ ok: false }, { status: 403 });
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return Response.json({ ok: false }, { status: 400 });
    const status = await dependencies.send(id, admin.id);
    if (!status) return Response.json({ ok: false }, { status: 404 });
    return Response.json({
      ok: [
        "sending",
        "sent",
        "delivered",
        "already_sent",
      ].includes(status),
      status,
    });
  } catch {
    return Response.json({ ok: false, status: "unknown" }, { status: 503 });
  }
}
