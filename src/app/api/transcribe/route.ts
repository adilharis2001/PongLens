import { NextResponse } from "next/server";
import { deepgramUsageEvents, recordUsage } from "@/lib/costs/meter";
import { shouldPersistTranscription } from "@/lib/journal/transcription";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, presignGet, putObject } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/transcribe — voice note upload + speech-to-text.
 *
 * multipart/form-data with an `audio` file (webm/mp4/wav, max 10 MB).
 * Persistent mode (the default for match voice notes) stores the audio at
 * r2://ponglens-media/voice/<userId>/<uuid>.<ext>, then returns
 * { audio_path, transcript }. Ephemeral mode (`persist=false`, used by
 * Journal dictation) sends the bytes directly to Deepgram and returns only
 * { transcript }; PongLens never writes those bytes to R2 or its ledger.
 *
 * Voice audio always lives under the AUTHOR's folder; /api/media-url
 * enforces that when streaming it back.
 *
 * `tier=review` (paid review findings) stores under review/<userId>/
 * instead of voice/<userId>/ — the review prefix has NO retention sweep,
 * because a paid deliverable must outlive the 90-day voice tier. Those
 * recordings are signed back by /api/review-media, not /api/media-url.
 */

const MAX_BYTES = 10 * 1024 * 1024;

const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/mp4": ".mp4",
  "video/mp4": ".mp4", // some browsers label MediaRecorder mp4 audio this way
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.error("transcribe: DEEPGRAM_API_KEY not configured");
    return NextResponse.json(
      { error: "Transcription is not available right now." },
      { status: 500 }
    );
  }

  let file: File | null = null;
  let persist = true;
  let tier: "voice" | "review" = "voice";
  try {
    const form = await req.formData();
    const entry = form.get("audio");
    if (entry instanceof File) file = entry;
    persist = shouldPersistTranscription(form.get("persist"));
    if (form.get("tier") === "review") tier = "review";
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Voice notes are limited to 10 MB." },
      { status: 413 }
    );
  }
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[mime];
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported audio format" },
      { status: 415 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let audioPath: string | null = null;

  try {
    if (persist) {
      const prefix = tier === "review" ? "review" : "voice";
      const key = `${prefix}/${user.id}/${crypto.randomUUID()}${ext}`;
      // Match voice notes preserve the recording even if the transcript is
      // imperfect. Journal dictation skips this entire branch.
      await putObject(MEDIA_BUCKET, key, bytes, mime);
      audioPath = `r2://${MEDIA_BUCKET}/${key}`;

      // Storage ledger (voice tier only; review artifacts are the coach's
      // work product, not the student's storage). Best-effort: accounting
      // must not break a recording that is already stored.
      if (tier === "voice") {
        const { error: ledgerError } = await supabase.rpc(
          "ledger_append_voice",
          {
            p_bytes: bytes.byteLength,
            p_key: audioPath,
          },
        );
        if (ledgerError) {
          console.error("transcribe: ledger append failed:", ledgerError);
        }
      }
    }

    const dgRes = await fetch(
      // mip_opt_out keeps recordings out of Deepgram's model-improvement
      // program — the Privacy Policy promises audio is transcribed and
      // nothing more, and this flag is what makes that promise true.
      "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&mip_opt_out=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": mime,
        },
        body: bytes,
      }
    );
    if (!dgRes.ok) {
      const text = await dgRes.text();
      console.error(`transcribe: Deepgram ${dgRes.status}: ${text.slice(0, 300)}`);
      return NextResponse.json(
        { error: "Transcription failed. Try again." },
        { status: 502 }
      );
    }
    const dg = await dgRes.json();
    await recordUsage(deepgramUsageEvents({
      response: dg,
      operation: "voice_note_transcription",
    }));
    const transcript: string =
      dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    if (!audioPath) {
      return NextResponse.json({ transcript });
    }
    // `url` lets the recorder hear what they just attached without a
    // second round-trip (the finding editor shows the student's view).
    const url = await presignGet(
      MEDIA_BUCKET,
      audioPath.replace(`r2://${MEDIA_BUCKET}/`, ""),
      { expiresSeconds: 3600, disposition: "inline" },
    );
    return NextResponse.json({ audio_path: audioPath, transcript, url });
  } catch (e) {
    console.error("transcribe error:", e);
    return NextResponse.json(
      { error: "Could not process the recording. Try again." },
      { status: 500 }
    );
  }
}
