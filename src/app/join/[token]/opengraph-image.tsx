import { inviteOgCard, inviteOgSize } from "@/components/inviteOgCard";
import { studentInviteCopy } from "@/lib/coaches/invitePreviewData";

/** The card a student sees when their coach sends them a join link (169). */
export const runtime = "nodejs";
export const alt = "A student invite on PongLens";
export const size = inviteOgSize;
export const contentType = "image/png";

export default async function OgImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return inviteOgCard(await studentInviteCopy((await params).token));
}
