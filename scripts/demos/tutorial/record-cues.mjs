/**
 * CDP screencast recorder with an annotation cue track.
 *
 * Same frame capture as scripts/demos/record.mjs (device-pixel-sharp, VFR
 * from CDP frame timestamps), plus two things a tutorial needs and a
 * marketing loop does not:
 *
 *   1. a clock the flow can steer by, so narration timing drives the
 *      picture rather than hand-tuned sleeps;
 *   2. a cue track — every highlight box, tap ripple and zoom target is
 *      recorded as {t, end, rect} in CSS pixels at the moment the real
 *      element was on screen.
 *
 * The cue track is the whole trick: annotations are DATA, so re-running
 * the capture after a UI change moves every box to where the element
 * actually is now. Both renderers (ffmpeg and Remotion) read the same file.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

/** The capture viewport, in CSS pixels — every cue rect must fit inside it. */
/**
 * The viewport a cue must fit inside. From the environment, not a constant:
 * hardcoded at 390x844 it rejected every single cue on the 1440-wide desktop
 * cut as "not on screen", which silently produced a video with no highlights
 * at all rather than an error anyone would notice.
 */
const VIEW = {
  w: Number(process.env.SHOT_W ?? 390),
  h: Number(process.env.SHOT_H ?? 844),
};

/**
 * How big a frame to ask the screencast for, in DEVICE pixels.
 *
 * Derived from the viewport rather than defaulted to a constant, because a
 * constant is how both cuts shipped soft. `maxWidth` used to default to 800:
 * the phone was captured at 390x844 — CSS pixels, no retina at all — and the
 * 1440-wide desktop cut came back 800x450, which the renderer then UPSCALED
 * to 1380 inside its window. Every pixel of text in that video had been
 * thrown away at capture and invented again at render.
 *
 * Two things have to agree for this to hold, and only one of them lives
 * here: Chrome's raster surface is 1x in headless regardless of the emulated
 * deviceScaleFactor, so the capture driver also has to launch with
 * --force-device-scale-factor. Ask for more than the surface has and the
 * screencast simply hands back the surface, which is exactly the silent
 * failure this pipeline keeps meeting. `assertFrameSize` below is the alarm.
 */
const DSF = Number(process.env.SHOT_DSF ?? 2);
const GRAB = {
  w: Number(process.env.SHOT_MAXW ?? VIEW.w * DSF),
  h: Number(process.env.SHOT_MAXH ?? VIEW.h * DSF),
};

export function makeCueRecorder(rawDir) {
  mkdirSync(rawDir, { recursive: true });

  return async function record(page, name, flow) {
    const framesDir = path.join(rawDir, `${name}.frames`);
    rmSync(framesDir, { recursive: true, force: true });
    mkdirSync(framesDir, { recursive: true });

    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    const cues = [];
    let n = 0;
    let t0Wall = null;
    let resolveReady;
    const ready = new Promise((r) => (resolveReady = r));

    cdp.on("Page.screencastFrame", (ev) => {
      const file = path.join(framesDir, `f${String(n++).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(ev.data, "base64"));
      frames.push({ file, ts: ev.metadata.timestamp });
      if (t0Wall === null) {
        t0Wall = Date.now();
        resolveReady();
      }
      cdp
        .send("Page.screencastFrameAck", { sessionId: ev.sessionId })
        .catch(() => {});
    });

    // The screencast stops on cross-document navigation and a bare restart
    // is a no-op while Chrome thinks it is live — hard stop+start, on every
    // main-frame navigation and on a slow keepalive tick.
    const arm = async () => {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp
        .send("Page.startScreencast", {
          format: "jpeg",
          // 95, not 90. Every frame is JPEG on the way out of Chrome and
          // H.264 twice after that, and the app is thin cyan text on near
          // black — the one thing JPEG ringing shows up on worst.
          quality: 95,
          // Caps, not a target: the screencast hands back whatever the raster
          // surface has, downscaled to fit inside these. See GRAB.
          maxWidth: GRAB.w,
          maxHeight: GRAB.h,
          everyNthFrame: 1,
        })
        .catch(() => {});
    };
    await cdp.send("Page.enable").catch(() => {});
    cdp.on("Page.frameNavigated", (ev) => {
      if (!ev.frame.parentId) void arm();
    });
    await arm();
    const keepalive = setInterval(() => void arm(), 2000);

    // Wait for real frames before the flow starts, so cue times and frame
    // times share an origin.
    await Promise.race([
      ready,
      new Promise((r) => setTimeout(r, 8000)).then(() => {
        if (t0Wall === null) t0Wall = Date.now();
      }),
    ]);

    const now = () => (Date.now() - t0Wall) / 1000;
    const clock = {
      now,
      /** Sleep until `t` seconds into the recording. */
      until: async (t) => {
        const ms = t * 1000 - (Date.now() - t0Wall);
        if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      /**
       * Record a cue. `rect` is in CSS pixels of the viewport; `end` is
       * absolute seconds (default: left open, closed at stop).
       */
      /**
       * Record a cue, and refuse an obviously wrong one.
       *
       * Both bad takes so far were the same mistake: a size floor in the
       * element picker matched an ANCESTOR of the intended target, so the
       * box spilled past the card it was meant to outline. That is
       * invisible in the cue JSON and only shows up on screen, after a
       * capture and a render. Checking it here turns a wasted round trip
       * into an immediate, named failure.
       */
      mark: (cue) => {
        if (cue.kind === "box") {
          const r = cue.rect;
          const bad =
            !r ||
            !(r.w > 4 && r.h > 4) ||
            r.x < -2 ||
            r.y < -2 ||
            r.x + r.w > VIEW.w + 2 ||
            r.y + r.h > VIEW.h + 2;
          if (bad) {
            throw new Error(
              `cue "${cue.label ?? ""}" is not on screen: ` +
                `${JSON.stringify(r)} outside ${VIEW.w}x${VIEW.h}`
            );
          }
        }
        const entry = { t: Number(now().toFixed(3)), ...cue };
        cues.push(entry);
        return entry;
      },
      /** Close an open cue at the current time. */
      close: (entry, at) => {
        entry.end = Number((at ?? now()).toFixed(3));
      },
      /** Bounding rect (CSS px) of the element `window.__pick(spec)` finds. */
      rect: async (spec) => {
        const r = await page.evaluate((a) => {
          const el = window.__pick(a);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        }, spec);
        if (!r) throw new Error("cue target not found");
        return r;
      },
    };

    try {
      await flow(page, clock);
    } finally {
      clearInterval(keepalive);
    }

    await cdp.send("Page.stopScreencast").catch(() => {});
    const endT = now();
    await new Promise((r) => setTimeout(r, 300));
    if (frames.length < 2) throw new Error(`flow ${name}: no frames`);
    for (const c of cues) if (c.end === undefined) c.end = Number(endT.toFixed(3));

    // What actually came back, before an hour is spent rendering it. A
    // screencast that quietly hands over the 1x surface is invisible in the
    // cue JSON, invisible in the logs, and obvious only in the finished
    // video — which is where it was found the first time, after two full
    // captures and two renders.
    const grabbed = spawnSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries",
       "stream=width,height", "-of", "csv=p=0", frames[0].file],
      { encoding: "utf8" }
    ).stdout?.trim();
    const [gw, gh] = String(grabbed).split(",").map(Number);
    console.log(
      `  ${frames.length} frames at ${gw}x${gh}, ${(
        frames[frames.length - 1].ts - frames[0].ts
      ).toFixed(2)}s, ${cues.length} cues`
    );
    // A tenth of slack for rounding; anything below that is the surface
    // being 1x, and the only honest thing to do is stop.
    if (gw < Math.min(GRAB.w, VIEW.w * DSF) * 0.9) {
      throw new Error(
        `capture came back ${gw}x${gh}, wanted about ${Math.min(GRAB.w, VIEW.w * DSF)} wide. ` +
          "The raster surface is 1x: launch Chrome with --force-device-scale-factor."
      );
    }

    const lines = [];
    for (let i = 0; i < frames.length; i++) {
      const dur =
        i + 1 < frames.length
          ? Math.max(0.005, frames[i + 1].ts - frames[i].ts)
          : 0.2;
      lines.push(`file '${frames[i].file}'`);
      lines.push(`duration ${dur.toFixed(4)}`);
    }
    lines.push(`file '${frames[frames.length - 1].file}'`);
    const listFile = path.join(framesDir, "list.txt");
    writeFileSync(listFile, lines.join("\n"));

    const out = path.join(rawDir, `${name}.mp4`);
    const res = spawnSync(
      "ffmpeg",
      [
        "-y", "-v", "error",
        "-f", "concat", "-safe", "0", "-i", listFile,
        "-fps_mode", "vfr",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        // This file is an intermediate — Remotion re-encodes every frame of
        // it — so it is worth being close to lossless here. Generation loss
        // at 16/fast was showing up as mush on the score bug's small type.
        "-c:v", "libx264", "-crf", "12", "-preset", "medium",
        "-pix_fmt", "yuv420p",
        out,
      ],
      { stdio: "inherit" }
    );
    if (res.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
    rmSync(framesDir, { recursive: true, force: true });
    return { out, cues, duration: endT };
  };
}
