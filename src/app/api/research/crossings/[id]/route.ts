import { evidenceBundle } from "@/lib/research/evidenceBundle";

export const dynamic = "force-dynamic";

/** The signal dump for one match on /research/crossings. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return evidenceBundle("research/crossings", id);
}
