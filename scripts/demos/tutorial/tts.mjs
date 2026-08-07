/**
 * Narration for a tutorial chapter — OpenAI text to speech, one file per line.
 *
 *   node scripts/demos/tutorial/tts.mjs <chapter>
 *
 * Narration is generated FIRST and its measured durations drive everything
 * downstream: the capture waits for exactly as long as each line takes to
 * speak, so picture and voice line up by construction instead of by hand
 * nudging an edit. Output: audio/<chapter>/<id>.mp3 plus voice/<chapter>.json
 * (per line: text, file, duration, and its start offset in the chapter).
 *
 * The key comes from OPENAI_API_KEY or the macOS Keychain (account
 * `openclaw`, service `openai-api-key`), same as the worker.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CHAPTER = process.argv[2] ?? "upload";
/**
 * Where chapters/, audio/ and voice/ live. Defaults to this pipeline's own
 * folder. The landing video passes its own directory so the two productions
 * keep separate scripts and audio while sharing the timing machinery, which
 * is the part that has to behave identically for both.
 *
 *   node tts.mjs landing ../landing
 */
const BASE = process.argv[3]
  ? path.resolve(DIR, process.argv[3])
  : DIR;

/**
 * Silence held after each line, and before the first word.
 *
 * Script-level now, not constants. The tutorials want room to follow an
 * instruction; a landing video wants to move. Half a second between every
 * line plus a per-line hold on top ran some joins to 1.7s of dead air,
 * which reads as the video having stalled rather than as breathing room.
 */
const DEFAULT_GAP_S = 0.5;
const DEFAULT_LEAD_S = 0.6;

const MODELS = ["gpt-4o-mini-tts", "tts-1-hd"];

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-a", "openclaw", "-s", "openai-api-key", "-w"],
      { encoding: "utf8" }
    ).trim();
  } catch {
    throw new Error(
      "No OpenAI key: set OPENAI_API_KEY or store it in the Keychain."
    );
  }
}

function durationOf(file) {
  return Number(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { encoding: "utf8" }
    ).trim()
  );
}

/**
 * ElevenLabs. A second provider rather than a replacement: the tutorial
 * chapters stay on OpenAI, where nine re-cuts are cheap, and the landing
 * video gets the better read. Everything downstream is unchanged, because
 * the timing map is built by measuring the files with ffprobe rather than
 * by trusting whatever the provider claims.
 */
async function speakEleven(key, script, line, file) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${script.voice}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: line.text,
        model_id: script.model ?? "eleven_multilingual_v2",
        voice_settings: script.settings ?? {},
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function speak(key, model, script, line, file, { withSpeed }) {
  const body = {
    model,
    voice: script.voice,
    input: line.text,
    response_format: "mp3",
  };
  // Delivery is steered two ways and not every model takes both: the
  // instructable model reads `instructions`, the older ones only resample
  // with `speed`. Ask for both, drop `speed` if the model rejects it.
  if (model !== "tts-1-hd" && script.instructions) {
    body.instructions = script.instructions;
  }
  if (withSpeed && script.speed) body.speed = script.speed;

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`${model} ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const script = JSON.parse(
  readFileSync(path.join(BASE, "chapters", `${CHAPTER}.json`), "utf8")
);
const audioDir = path.join(BASE, "audio", CHAPTER);
mkdirSync(audioDir, { recursive: true });
mkdirSync(path.join(BASE, "voice"), { recursive: true });
const eleven = script.provider === "elevenlabs";
const key = eleven
  ? execFileSync(
      "security",
      ["find-generic-password", "-s", "elevenlabs-api-key", "-w"],
      { encoding: "utf8" }
    ).trim()
  : apiKey();
const GAP_S = script.gap ?? DEFAULT_GAP_S;
const LEAD_S = script.lead ?? DEFAULT_LEAD_S;

let model = null;
let withSpeed = Boolean(script.speed);
const lines = [];
let at = LEAD_S;
let words = 0;

for (const line of script.lines) {
  const file = path.join(audioDir, `${line.id}.mp3`);
  if (eleven) {
    await speakEleven(key, script, line, file);
    if (!model) {
      model = script.model ?? "eleven_multilingual_v2";
      console.log(`voice: ${script.voiceName ?? script.voice} on ${model}`);
    }
  } else if (model) {
    try {
      await speak(key, model, script, line, file, { withSpeed });
    } catch (err) {
      if (!withSpeed || err.status !== 400) throw err;
      withSpeed = false;
      await speak(key, model, script, line, file, { withSpeed });
    }
  } else {
    let lastErr;
    for (const candidate of MODELS) {
      for (const speedTry of withSpeed ? [true, false] : [false]) {
        try {
          await speak(key, candidate, script, line, file, { withSpeed: speedTry });
          model = candidate;
          withSpeed = speedTry;
          console.log(
            `voice: ${script.voice} on ${model}` +
              (speedTry ? ` at speed ${script.speed}` : " (speed unsupported)")
          );
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (model) break;
    }
    if (!model) throw lastErr;
  }

  const dur = durationOf(file);
  words += line.text.split(/\s+/).length;
  lines.push({
    id: line.id,
    beat: line.beat,
    // Carried through for the renderer's section header. The tutorials do
    // not use it; the landing video shows a short label above the device
    // that changes as the story moves.
    label: line.label ?? "",
    text: line.text,
    file: path.relative(BASE, file),
    start: Number(at.toFixed(3)),
    dur: Number(dur.toFixed(3)),
  });
  console.log(
    `  ${line.id}  ${dur.toFixed(2)}s  @${at.toFixed(2)}s` +
      (line.pause ? `  (+${line.pause}s hold)` : "")
  );
  // `pause` buys a beat more screen time than its sentence needs. Beats are
  // pinned to narration, so without it the only way to hold a shot for
  // longer is to pad the writing — which is exactly how lines end up
  // rambling. Silence is the honest fix.
  at += dur + GAP_S + (line.pause ?? 0);
}

const spoken = lines.reduce((s, l) => s + l.dur, 0);
const voice = {
  chapter: script.chapter,
  title: script.title,
  subtitle: script.subtitle,
  model,
  lead: LEAD_S,
  gap: GAP_S,
  total: Number(at.toFixed(3)),
  wpm: Math.round((words / spoken) * 60),
  lines,
};
writeFileSync(
  path.join(BASE, "voice", `${CHAPTER}.json`),
  `${JSON.stringify(voice, null, 2)}\n`
);
console.log(`total ${voice.total.toFixed(1)}s at ${voice.wpm} wpm -> voice/${CHAPTER}.json`);
