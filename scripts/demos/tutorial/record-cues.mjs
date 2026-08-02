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
const VIEW = { w: 390, h: 844 };

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
          quality: 90,
          maxWidth: 800,
          maxHeight: 1720,
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

    console.log(
      `  ${frames.length} frames, ${(
        frames[frames.length - 1].ts - frames[0].ts
      ).toFixed(2)}s, ${cues.length} cues`
    );

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
        "-c:v", "libx264", "-crf", "16", "-preset", "fast",
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
