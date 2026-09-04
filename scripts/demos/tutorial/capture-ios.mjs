/**
 * Capture the two real iOS surfaces used by the tutorial course.
 *
 *   SERVICE_KEY=... TUTORIAL_PLAYER=... node capture-ios.mjs player-record
 *   SERVICE_KEY=... TUTORIAL_COACH=... node capture-ios.mjs coach-audio-lesson
 *
 * The service-role key never leaves this process. Only the one-time token
 * hash returned by Supabase is passed to the DEBUG app launch.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogChapter } from "./course-paths.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DIR, "../../..");
const DEFAULT_UDID = "E62D60DD-6664-4C19-ADBE-ECF1A67E0047";
const BUNDLE_ID = "com.ponglens.PongLens";
const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const USAGE =
  "usage: SERVICE_KEY=... capture-ios.mjs <player-record|coach-audio-lesson> [--udid <iOS-26.5-simulator>]";

const SCENARIOS = {
  "player-record": {
    course: "player",
    chapter: "upload",
    accountEnv: ["TUTORIAL_PLAYER", "TUTORIAL_ACCOUNT"],
    trimStart: 0,
  },
  "coach-audio-lesson": {
    course: "coach",
    chapter: "coach-audio-lesson",
    accountEnv: ["TUTORIAL_COACH"],
    trimStart: 1,
  },
};

export function parseIOSCaptureArgs(args, env = process.env) {
  if (args.length !== 1 && args.length !== 3) throw new Error(USAGE);
  const scenario = args[0];
  if (!Object.hasOwn(SCENARIOS, scenario)) {
    throw new Error(`${USAGE}\nUnknown tutorial capture scenario: ${String(scenario)}`);
  }
  if (args.length === 3 && (args[1] !== "--udid" || !args[2])) {
    throw new Error(USAGE);
  }
  return {
    scenario,
    udid: args.length === 3 ? args[2] : env.IOS_SIMULATOR_UDID ?? DEFAULT_UDID,
  };
}

export function selectIOS26Simulator(list, udid) {
  for (const [runtimeID, devices] of Object.entries(list?.devices ?? {})) {
    const device = devices.find((candidate) => candidate.udid === udid);
    if (!device) continue;
    if (
      runtimeID !== "com.apple.CoreSimulator.SimRuntime.iOS-26-5" ||
      !device.isAvailable ||
      !String(device.deviceTypeIdentifier ?? "").includes(".iPhone-")
    ) {
      throw new Error(
        `Simulator ${udid} must be an available iPhone running iOS 26.5`,
      );
    }
    return {
      udid: device.udid,
      name: device.name,
      state: device.state,
      runtime: "iOS 26.5",
    };
  }
  throw new Error(`Simulator ${udid} is not available`);
}

export function tutorialDerivedDataPath(repo = REPO, tempRoot = os.tmpdir()) {
  return path.join(tempRoot, "ponglens-tutorial-derived-data", path.basename(repo));
}

export async function withCaptureCleanup(run, { stopRecorder, terminateApp }) {
  let value;
  let runError;
  try {
    value = await run();
  } catch (error) {
    runError = error;
  }

  let cleanupError;
  try {
    await stopRecorder();
  } catch (error) {
    cleanupError = error;
  }
  try {
    await terminateApp();
  } catch (error) {
    cleanupError ??= error;
  }

  if (runError) throw runError;
  if (cleanupError) throw cleanupError;
  return value;
}

const videoDuration = (file) => {
  const result = spawnSync(
    "ffprobe",
    [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", file,
    ],
    { encoding: "utf8" },
  );
  const duration = Number(result.stdout);
  if (result.status !== 0 || !(duration > 0)) {
    throw new Error("Captured native video could not be measured");
  }
  return duration;
};

/**
 * simctl writes variable-frame-rate video. Once a review screen becomes
 * completely still its final frame can be timestamped well before the wall
 * clock recorder stops. Keep that genuine final app frame on screen so the
 * chapter source has the duration the capture manifest promises.
 */
export function ensureCaptureDuration(file, targetSeconds, { trimStart = 0 } = {}) {
  const duration = videoDuration(file);
  if (duration >= targetSeconds && trimStart === 0) return duration;
  const padded = `${file}.padded-${process.pid}.mp4`;
  try {
    const remaining = Math.max(0, duration - trimStart);
    const pad = Math.max(0, targetSeconds - remaining + 0.1);
    const filters = [
      ...(trimStart > 0 ? [`trim=start=${trimStart}`, "setpts=PTS-STARTPTS"] : []),
      "fps=30",
      `tpad=stop_mode=clone:stop_duration=${pad}`,
    ];
    const result = spawnSync(
      "ffmpeg",
      [
        "-loglevel", "error", "-y", "-i", file,
        "-vf", filters.join(","),
        "-t", String(targetSeconds),
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", padded,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    if (result.status !== 0) throw new Error("Could not finalize native capture duration");
    renameSync(padded, file);
  } finally {
    rmSync(padded, { force: true });
  }
  let finalized = videoDuration(file);
  if (finalized + 0.01 < targetSeconds) {
    // VFR simulator movies can lose a little more timeline than their
    // container duration predicts when the leading presentation is cut.
    // Measure the normalized file itself, then extend that known timeline.
    const extended = `${file}.extended-${process.pid}.mp4`;
    try {
      const result = spawnSync(
        "ffmpeg",
        [
          "-loglevel", "error", "-y", "-i", file,
          "-vf", `fps=30,tpad=stop_mode=clone:stop_duration=${targetSeconds - finalized + 0.1}`,
          "-t", String(targetSeconds),
          "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
          "-movflags", "+faststart", extended,
        ],
        { stdio: ["ignore", "inherit", "inherit"] },
      );
      if (result.status !== 0) throw new Error("Could not extend native capture duration");
      renameSync(extended, file);
    } finally {
      rmSync(extended, { force: true });
    }
    finalized = videoDuration(file);
  }
  if (finalized + 0.01 < targetSeconds) {
    throw new Error(`Native capture finalized at ${finalized}s, below ${targetSeconds}s`);
  }
  return finalized;
}

const runSync = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: REPO,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} failed (${result.status ?? "signal"})`,
    );
  }
  return result.stdout ?? "";
};

const waitForText = (child, expected, timeoutMs, abortSignal) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-8192);
      if (output.includes(expected)) finish();
    };
    const onAbort = () => finish(abortSignal.reason ?? new Error("capture interrupted"));
    const timer = setTimeout(
      () => finish(new Error(`Timed out waiting for ${expected}`)),
      timeoutMs,
    );
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (!settled) {
        finish(new Error(`process exited before readiness (${code ?? signal})`));
      }
    });
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });

const waitForExit = (child, timeoutMs) =>
  new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });

export function stopRecorderProcess(child, timeoutMs = 15000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let forced = null;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      forced = setTimeout(resolve, 1000);
    }, timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      if (forced) clearTimeout(forced);
      resolve();
    });
    // Register the close listener before sending SIGINT. simctl exits only
    // after it has flushed and finalized the QuickTime file.
    child.kill("SIGINT");
  });
}

export async function beginRecordingAfterPresentation({
  waitForPresentation,
  startRecorder,
}) {
  await waitForPresentation();
  return startRecorder();
}

const wait = (milliseconds, abortSignal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortSignal.reason ?? new Error("capture interrupted"));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });

async function mintTokenHash(serviceKey, email) {
  const response = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const data = await response.json();
  if (!response.ok || !data.hashed_token) {
    throw new Error(`Could not mint the tutorial account sign-in (${response.status})`);
  }
  return data.hashed_token;
}

export async function runIOSCapture(args, env = process.env) {
  const request = parseIOSCaptureArgs(args, env);
  const deviceList = JSON.parse(
    runSync("xcrun", ["simctl", "list", "devices", "available", "--json"]),
  );
  const simulator = selectIOS26Simulator(deviceList, request.udid);
  const scenario = SCENARIOS[request.scenario];
  const chapter = catalogChapter(scenario.course, scenario.chapter);

  const nativeDir = path.join(DIR, "raw", "native");
  const derivedData = tutorialDerivedDataPath();
  const output = path.join(nativeDir, `${request.scenario}.mp4`);
  const app = path.join(
    derivedData,
    "Build",
    "Products",
    "Debug-iphonesimulator",
    "PongLens.app",
  );
  mkdirSync(nativeDir, { recursive: true });

  console.log(
    `Building DEBUG capture for ${simulator.name} (${simulator.runtime})…`,
  );
  runSync(
    "xcodebuild",
    [
      "build",
      "-project", path.join(REPO, "ios", "PongLens", "PongLens.xcodeproj"),
      "-scheme", "PongLens",
      "-configuration", "Debug",
      "-destination", `id=${simulator.udid}`,
      "-derivedDataPath", derivedData,
      "CODE_SIGNING_ALLOWED=NO",
      "-quiet",
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );

  if (simulator.state !== "Booted") {
    runSync("xcrun", ["simctl", "boot", simulator.udid]);
  }
  runSync("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  runSync("xcrun", ["simctl", "install", simulator.udid, app]);

  // Invalid scenario, device, runtime, and failed build/install all stop
  // before either credential is read.
  const serviceKey = env.SERVICE_KEY;
  if (!serviceKey) throw new Error("SERVICE_KEY env var required");
  const account = scenario.accountEnv
    .map((name) => env[name])
    .find((value) => typeof value === "string" && value.trim());
  if (!account) {
    throw new Error(`${scenario.accountEnv.join(" or ")} env var required`);
  }
  const tokenHash = await mintTokenHash(serviceKey, account);

  let recorder = null;
  let appConsole = null;
  let appLaunched = false;
  const abort = new AbortController();
  let signalName = null;
  const onSignal = (signal) => {
    signalName = signal;
    abort.abort(new Error(`capture interrupted by ${signal}`));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const cleanup = {
    stopRecorder: async () => {
      await stopRecorderProcess(recorder);
      recorder = null;
    },
    terminateApp: async () => {
      const consoleClosed = appConsole ? waitForExit(appConsole, 5000) : null;
      if (appLaunched) {
        spawnSync("xcrun", ["simctl", "terminate", simulator.udid, BUNDLE_ID], {
          stdio: "ignore",
        });
      }
      if (consoleClosed) {
        await consoleClosed;
      }
      appConsole = null;
      appLaunched = false;
    },
  };

  try {
    await withCaptureCleanup(async () => {
      appConsole = spawn(
        "xcrun",
        [
          "simctl", "launch", "--terminate-running-process", "--console-pty",
          simulator.udid, BUNDLE_ID,
          "--dev-token-hash", tokenHash,
          "--tutorial-capture", request.scenario,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          // Swift stdout is block-buffered when simctl is not attached to a
          // terminal. The readiness line must arrive while the app is alive,
          // not only after capture cleanup terminates it.
          env: { ...process.env, SIMCTL_CHILD_NSUnbufferedIO: "YES" },
        },
      );
      appLaunched = true;
      const marker = `PONGLENS_TUTORIAL_CAPTURE_READY ${request.scenario}`;
      console.log(`Waiting for ${request.scenario} to be ready…`);
      await waitForText(appConsole, marker, 60000, abort.signal);

      await beginRecordingAfterPresentation({
        // The Task 6 marker names the real screen state. RootView's branded
        // cold-start overlay clears a moment later, so let that presentation
        // finish before the first source frame is committed.
        waitForPresentation: () => wait(400, abort.signal),
        startRecorder: async () => {
          recorder = spawn(
            "xcrun",
            [
              "simctl", "io", simulator.udid, "recordVideo",
              "--codec=h264", "--mask=black", "--force", output,
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          await waitForText(recorder, "Recording started", 20000, abort.signal);
        },
      });
      console.log(`Recording ${request.scenario} for ${chapter.seconds}s…`);
      await wait(chapter.seconds * 1000, abort.signal);
    }, cleanup);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }

  if (signalName) throw new Error(`capture interrupted by ${signalName}`);
  ensureCaptureDuration(output, chapter.seconds, {
    trimStart: scenario.trimStart,
  });
  console.log(`Captured ${path.relative(REPO, output)}`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runIOSCapture(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
