import { evidenceBundle } from "@/lib/research/evidenceBundle";

export const dynamic = "force-dynamic";

/** The per-card serve diagnosis for one match on /research/serve-misses. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return evidenceBundle("research/crossings", id, ".serves.json");
}
