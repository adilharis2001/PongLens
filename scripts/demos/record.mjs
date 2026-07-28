/**
 * CDP screencast recorder — device-pixel-sharp captures of real product
 * flows for the landing page (Playwright's recordVideo captures at CSS
 * pixels; marketing needs the retina raster).
 *
 * Frames arrive via Page.startScreencast at deviceScaleFactor resolution
 * with timestamps; ffmpeg reassembles them into a variable-frame-rate
 * intermediate mp4 per flow under scripts/demos/raw/. render.sh then cuts
 * the shipped loops.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

export function makeRecorder(rawDir) {
  mkdirSync(rawDir, { recursive: true });

  return async function record(page, name, flow) {
    const framesDir = path.join(rawDir, `${name}.frames`);
    rmSync(framesDir, { recursive: true, force: true });
    mkdirSync(framesDir, { recursive: true });

    const cdp = await page.context().newCDPSession(page);
    const frames = []; // { file, ts }
    let n = 0;
    cdp.on("Page.screencastFrame", (ev) => {
      const file = path.join(
        framesDir,
        `f${String(n++).padStart(6, "0")}.jpg`
      );
      writeFileSync(file, Buffer.from(ev.data, "base64"));
      frames.push({ file, ts: ev.metadata.timestamp });
      cdp
        .send("Page.screencastFrameAck", { sessionId: ev.sessionId })
        .catch(() => {});
    });
    // The screencast silently stops on cross-document navigations, and a
    // bare re-start while Chrome believes it is active is a no-op — so
    // re-arm with a hard stop+start, on every main-frame navigation AND
    // on a slow keepalive tick (belt and braces; both are cheap).
    const arm = async () => {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp
        .send("Page.startScreencast", {
          format: "jpeg",
          quality: 88,
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

    try {
      await flow(page);
    } finally {
      clearInterval(keepalive);
    }

    await cdp.send("Page.stopScreencast").catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    if (frames.length < 2) throw new Error(`flow ${name}: no frames`);
    console.log(
      `  ${frames.length} frames, ts span ${(
        frames[frames.length - 1].ts - frames[0].ts
      ).toFixed(2)}s`
    );

    // concat list with per-frame durations from the CDP timestamps
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
        "-y",
        "-v",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-fps_mode",
        "vfr",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v",
        "libx264",
        "-crf",
        "16",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        out,
      ],
      { stdio: "inherit" }
    );
    if (res.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
    rmSync(framesDir, { recursive: true, force: true });
    return out;
  };
}
