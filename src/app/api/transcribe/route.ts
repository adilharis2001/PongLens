import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, putObject } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/transcribe — voice note upload + speech-to-text.
 *
 * multipart/form-data with an `audio` file (webm/mp4/wav, max 10 MB).
 * 1. Stores the audio at r2://ponglens-media/voice/<userId>/<uuid>.<ext>
 *    (voice tier: kept 90 days, worker cron sweeps).
 * 2. Transcribes with Deepgram nova-3 (smart_format on).
 * 3. Returns { audio_path, transcript }. The client shows the transcript
 *    in the editable note field and saves the note with both.
 *
 * Voice audio always lives under the AUTHOR's folder; /api/media-url
 * enforces that when streaming it back.
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
  try {
    const form = await req.formData();
    const entry = form.get("audio");
    if (entry instanceof File) file = entry;
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
  const key = `voice/${user.id}/${crypto.randomUUID()}${ext}`;

  try {
    // Store the audio first: even if the transcript is imperfect the
    // recording is preserved and stays playable from the note.
    await putObject(MEDIA_BUCKET, key, bytes, mime);

    const dgRes = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true",
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
    const transcript: string =
      dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    return NextResponse.json({
      audio_path: `r2://${MEDIA_BUCKET}/${key}`,
      transcript,
    });
  } catch (e) {
    console.error("transcribe error:", e);
    return NextResponse.json(
      { error: "Could not process the recording. Try again." },
      { status: 500 }
    );
  }
}
