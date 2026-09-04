import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(DIR, "capture-ios.mjs");
const MANIFEST = path.join(DIR, "native-inserts.json");

test("native capture driver and manifest are executable production inputs", async () => {
  assert.equal(existsSync(DRIVER), true, "capture-ios.mjs must exist");
  assert.equal(existsSync(MANIFEST), true, "native-inserts.json must exist");

  const driver = await import(DRIVER);
  const renderer = await import("./render-b.mjs");
  assert.equal(typeof driver.parseIOSCaptureArgs, "function");
  assert.equal(typeof driver.selectIOS26Simulator, "function");
  assert.equal(typeof driver.withCaptureCleanup, "function");
  assert.equal(typeof renderer.validateNativeInserts, "function");
  assert.equal(typeof renderer.probeNativeVideo, "function");
});

test("capture arguments reject bad input before credentials are needed", async () => {
  if (!existsSync(DRIVER)) return;
  const { parseIOSCaptureArgs } = await import(DRIVER);
  const env = {};

  assert.deepEqual(parseIOSCaptureArgs(["player-record"], env), {
    scenario: "player-record",
    udid: "E62D60DD-6664-4C19-ADBE-ECF1A67E0047",
  });
  assert.deepEqual(
    parseIOSCaptureArgs(
      ["coach-audio-lesson", "--udid", "739B7E91-E72A-4937-BEC9-EE7F9281BCD4"],
      env,
    ),
    {
      scenario: "coach-audio-lesson",
      udid: "739B7E91-E72A-4937-BEC9-EE7F9281BCD4",
    },
  );
  assert.throws(() => parseIOSCaptureArgs(["unknown"], env), /scenario/i);
  assert.throws(() => parseIOSCaptureArgs(["player-record", "--udid"], env), /usage/i);
});

test("simulator selection requires an available iPhone on iOS 26.5", async () => {
  if (!existsSync(DRIVER)) return;
  const { selectIOS26Simulator } = await import(DRIVER);
  const available = {
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
        {
          udid: "GOOD",
          name: "iPhone 17 Pro",
          state: "Shutdown",
          isAvailable: true,
          deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
        },
      ],
      "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
        {
          udid: "OLD",
          name: "iPhone 17 Pro",
          state: "Booted",
          isAvailable: true,
          deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
        },
      ],
    },
  };

  assert.deepEqual(selectIOS26Simulator(available, "GOOD"), {
    udid: "GOOD",
    name: "iPhone 17 Pro",
    state: "Shutdown",
    runtime: "iOS 26.5",
  });
  assert.throws(() => selectIOS26Simulator(available, "OLD"), /iOS 26\.5/);
  assert.throws(() => selectIOS26Simulator(available, "MISSING"), /available/i);
});

test("iOS build products stay outside the web source tree", async () => {
  if (!existsSync(DRIVER)) return;
  const { tutorialDerivedDataPath } = await import(DRIVER);
  assert.equal(typeof tutorialDerivedDataPath, "function");
  const repo = path.join(os.tmpdir(), "ponglens-repo-fixture");
  const derivedData = tutorialDerivedDataPath(repo, os.tmpdir());
  assert.equal(
    path.relative(repo, derivedData).startsWith(".."),
    true,
    `DerivedData leaked into repository: ${derivedData}`,
  );
});

test("capture cleanup stops the recorder and app on success and failure", async () => {
  if (!existsSync(DRIVER)) return;
  const { withCaptureCleanup } = await import(DRIVER);

  for (const failure of [null, new Error("capture failed")]) {
    const events = [];
    const run = () => {
      events.push("run");
      if (failure) throw failure;
      return "ok";
    };
    const work = withCaptureCleanup(run, {
      stopRecorder: async () => events.push("stop-recorder"),
      terminateApp: async () => events.push("terminate-app"),
    });

    if (failure) await assert.rejects(work, /capture failed/);
    else assert.equal(await work, "ok");
    assert.deepEqual(events, ["run", "stop-recorder", "terminate-app"]);
  }

  const cleanupEvents = [];
  await assert.rejects(
    withCaptureCleanup(async () => "ok", {
      stopRecorder: async () => {
        cleanupEvents.push("stop-recorder");
        throw new Error("recorder cleanup failed");
      },
      terminateApp: async () => cleanupEvents.push("terminate-app"),
    }),
    /recorder cleanup failed/,
  );
  assert.deepEqual(cleanupEvents, ["stop-recorder", "terminate-app"]);
});

test("recorder shutdown waits for simctl to finalize the movie", async () => {
  if (!existsSync(DRIVER)) return;
  const { stopRecorderProcess } = await import(DRIVER);
  assert.equal(typeof stopRecorderProcess, "function");
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    assert.equal(signal, "SIGINT");
    setTimeout(() => {
      child.signalCode = "SIGINT";
      child.emit("close");
    }, 20);
  };
  const started = Date.now();
  await stopRecorderProcess(child, 1000);
  assert.ok(Date.now() - started >= 15, "returned before the movie close event");
});

test("recording starts only after the ready screen has cleared its presentation overlay", async () => {
  if (!existsSync(DRIVER)) return;
  const { beginRecordingAfterPresentation } = await import(DRIVER);
  assert.equal(typeof beginRecordingAfterPresentation, "function");
  const events = [];
  await beginRecordingAfterPresentation({
    waitForPresentation: async () => events.push("settled"),
    startRecorder: async () => events.push("recording"),
  });
  assert.deepEqual(events, ["settled", "recording"]);
});

test("native inserts are catalog-owned, time bounded, and exclude paid reviews", async () => {
  if (!existsSync(MANIFEST)) return;
  const { validateNativeInserts } = await import("./render-b.mjs");
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const validated = validateNativeInserts(manifest.inserts, DIR);

  assert.deepEqual(
    validated.map(({ course, chapter }) => `${course}/${chapter}`),
    ["player/upload", "coach/coach-audio-lesson"],
  );
  for (const insert of validated) {
    assert.ok(insert.end > insert.start);
    assert.ok(insert.at >= 0);
    assert.ok(insert.source.startsWith("raw/native/"));
    assert.notEqual(insert.chapter, "coach-paid-review");
  }
  assert.throws(
    () => validateNativeInserts([{ ...validated[0], source: "../../private.mp4" }], DIR),
    /raw\/native/,
  );
});

test("native video dimensions are discovered before render", async () => {
  if (!existsSync(DRIVER)) return;
  const { probeNativeVideo } = await import("./render-b.mjs");
  const temp = mkdtempSync(path.join(os.tmpdir(), "ponglens-native-insert-"));
  const video = path.join(temp, "portrait.mp4");
  try {
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=390x844:d=0.2:r=30",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
    ]);
    assert.deepEqual(probeNativeVideo(video), {
      width: 390,
      height: 844,
      duration: 0.2,
    });
    assert.throws(() => probeNativeVideo(path.join(temp, "missing.mp4")), /native source/i);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("capture finalization keeps a static final screen for the requested duration", async () => {
  if (!existsSync(DRIVER)) return;
  const { ensureCaptureDuration } = await import(DRIVER);
  assert.equal(typeof ensureCaptureDuration, "function");
  const { probeNativeVideo } = await import("./render-b.mjs");
  const temp = mkdtempSync(path.join(os.tmpdir(), "ponglens-native-duration-"));
  const video = path.join(temp, "short.mp4");
  try {
    execFileSync("ffmpeg", [
      "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=red:s=390x844:d=1:r=30",
      "-f", "lavfi", "-i", "color=c=blue:s=390x844:d=1:r=30",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[out]",
      "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
    ]);
    ensureCaptureDuration(video, 2, { trimStart: 1 });
    const measured = probeNativeVideo(video);
    assert.ok(measured.duration >= 2 && measured.duration < 2.1, measured.duration);
    assert.deepEqual({ width: measured.width, height: measured.height }, { width: 390, height: 844 });
    const firstPixel = execFileSync("ffmpeg", [
      "-loglevel", "error", "-i", video, "-frames:v", "1", "-vf", "scale=1:1",
      "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
    ]);
    assert.ok(firstPixel[2] > firstPixel[0], "trimmed source should begin on the blue screen");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("render preparation stages player inserts and promotes the coach source", async () => {
  if (!existsSync(DRIVER) || !existsSync(MANIFEST)) return;
  const { prepareNativeChapter } = await import("./render-b.mjs");
  const temp = mkdtempSync(path.join(os.tmpdir(), "ponglens-native-prepare-"));
  const project = path.join(temp, "remotion");
  const nativeDir = path.join(temp, "raw", "native");
  mkdirSync(path.join(project, "src"), { recursive: true });
  mkdirSync(path.join(project, "public"), { recursive: true });
  mkdirSync(nativeDir, { recursive: true });
  try {
    for (const name of ["player-record", "coach-audio-lesson"]) {
      execFileSync("ffmpeg", [
        "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=390x844:d=2:r=30",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(nativeDir, `${name}.mp4`),
      ]);
    }
    const fixtures = [
      {
        course: "player", chapter: "upload", source: "raw/native/player-record.mp4",
        start: 0.2, end: 1.2, at: 4,
      },
      {
        course: "coach", chapter: "coach-audio-lesson",
        source: "raw/native/coach-audio-lesson.mp4", start: 0, end: 1.8, at: 0,
      },
    ];

    const player = prepareNativeChapter("player", "upload", {
      root: temp, project, inserts: fixtures,
    });
    assert.equal(player.mode, "insert");
    assert.equal(existsSync(path.join(project, "public", "native-insert.mp4")), true);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(project, "src", "inserts.json"), "utf8")).nativeInserts,
      [{ src: "native-insert.mp4", start: 0.2, end: 1.2, at: 4 }],
    );

    const coach = prepareNativeChapter("coach", "coach-audio-lesson", {
      root: temp, project, inserts: fixtures,
    });
    assert.equal(coach.mode, "chapter");
    assert.equal(existsSync(path.join(temp, "raw", "coach", "tut-coach-audio-lesson.mp4")), true);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(temp, "raw", "coach", "tut-coach-audio-lesson.cues.json"), "utf8")),
      {
        course: "coach",
        chapter: "coach-audio-lesson",
        video: "tut-coach-audio-lesson.mp4",
        viewport: { w: 390, h: 844, dsf: 1 },
        duration: 2,
        cues: [],
      },
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
