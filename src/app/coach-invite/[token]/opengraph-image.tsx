import { inviteOgCard, inviteOgSize } from "@/components/inviteOgCard";
import { coachInviteCopy } from "@/lib/coaches/invitePreviewData";

/** The card a coach sees when a player sends them an invite (169). */
export const runtime = "nodejs";
export const alt = "A coach invite on PongLens";
export const size = inviteOgSize;
export const contentType = "image/png";

export default async function OgImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return inviteOgCard(await coachInviteCopy((await params).token));
}
