export type BetaMessageKind = "invite" | "admin";
export type BetaSendState = "sent" | "suppressed" | "failed";
export type BetaDeliveryState = BetaSendState | "already_sent";
export type BetaDeliveryStamp =
  | "invite_sent"
  | "invite_suppressed"
  | "admin_sent"
  | "admin_suppressed";

export type BetaRequestRecord = {
  id: string;
  email: string;
  requestedAt: string;
  inviteNeeded: boolean;
  adminNoticeNeeded: boolean;
};

export type BetaDeliveryResult = {
  invite: BetaDeliveryState;
  admin: BetaDeliveryState;
};

export type BetaDeliveryDependencies = {
  send(
    kind: BetaMessageKind,
    request: BetaRequestRecord,
  ): Promise<BetaSendState>;
  stamp(kind: BetaDeliveryStamp, requestId: string): Promise<void>;
  reportError?(kind: BetaMessageKind, error: unknown): void;
};

export function betaIdempotencyKey(
  requestId: string,
  kind: BetaMessageKind,
): string {
  return `ios-beta-${requestId}-${kind}`;
}

async function deliverOne(
  kind: BetaMessageKind,
  request: BetaRequestRecord,
  dependencies: BetaDeliveryDependencies,
): Promise<BetaSendState> {
  try {
    const state = await dependencies.send(kind, request);
    if (state === "sent") {
      await dependencies.stamp(
        kind === "invite" ? "invite_sent" : "admin_sent",
        request.id,
      );
    } else if (state === "suppressed") {
      await dependencies.stamp(
        kind === "invite" ? "invite_suppressed" : "admin_suppressed",
        request.id,
      );
    }
    return state;
  } catch (error) {
    if (dependencies.reportError) dependencies.reportError(kind, error);
    else console.error(`iOS beta ${kind} delivery failed:`, error);
    return "failed";
  }
}

export async function deliverBetaRecord(
  request: BetaRequestRecord,
  dependencies: BetaDeliveryDependencies,
): Promise<BetaDeliveryResult> {
  const [invite, admin] = await Promise.all([
    request.inviteNeeded
      ? deliverOne("invite", request, dependencies)
      : Promise.resolve<BetaDeliveryState>("already_sent"),
    request.adminNoticeNeeded
      ? deliverOne("admin", request, dependencies)
      : Promise.resolve<BetaDeliveryState>("already_sent"),
  ]);
  return { invite, admin };
}
