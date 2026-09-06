import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  catalogChapters,
  chapterPaths,
  parseChapterRef,
} from "./course-paths.mjs";
import { parseCaptureArgs } from "./capture.mjs";
import { parseGuardArgs } from "./guard.mjs";
import { parseProbeArgs } from "./probe.mjs";
import { parseRenderArgs } from "./render-b.mjs";
import { parseTTSArgs } from "./tts.mjs";

const root = path.join("tmp", "tutorial");

test("importing the publisher has no credential, filesystem, or network side effects", () => {
  const publishFile = fileURLToPath(new URL("./publish.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(new URL(`file://${publishFile}`).href)})`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        R2_ACCOUNT_ID: "test-account",
        R2_ACCESS_KEY_ID: "test-key-id",
        R2_SECRET_ACCESS_KEY: "test-secret",
      },
      timeout: 10_000,
    },
  );

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

test("publish plans select only catalog-owned course keys and namespaced outputs", async () => {
  const { publishPlan } = await import("./publish.mjs");
  const pipelineRoot = fileURLToPath(new URL(".", import.meta.url));
  const expectedPlayerKeys = [
    "tutorial/player/home.mp4",
    "tutorial/player/upload.mp4",
    "tutorial/player/viewer.mp4",
    "tutorial/player/point.mp4",
    "tutorial/player/keepscore.mp4",
    "tutorial/player/analysis.mp4",
    "tutorial/player/export.mp4",
    "tutorial/player/coach.mp4",
    "tutorial/player/journal.mp4",
  ];
  const expectedCoachKeys = [
    "tutorial/coach/coach-start.mp4",
    "tutorial/coach/coach-add-student.mp4",
    "tutorial/coach/coach-connect-account.mp4",
    "tutorial/coach/coach-lesson-entry.mp4",
    "tutorial/coach/coach-audio-lesson.mp4",
    "tutorial/coach/coach-share-entry.mp4",
    "tutorial/coach/coach-review-match.mp4",
    "tutorial/coach/coach-feedback.mp4",
    "tutorial/coach/coach-paid-review.mp4",
  ];

  const playerWeb = publishPlan("player", "web");
  const coachWeb = publishPlan("coach", "web");
  const coachIOS = publishPlan("coach", "ios");

  assert.deepEqual(playerWeb.map(({ key }) => key), expectedPlayerKeys);
  assert.deepEqual(coachWeb.map(({ key }) => key), expectedCoachKeys);
  assert.deepEqual(coachIOS.map(({ key }) => key), expectedCoachKeys.slice(0, 8));
  for (const entry of [...playerWeb, ...coachWeb]) {
    const courseOutputRoot = path.resolve(pipelineRoot, "out", entry.course);
    assert.equal(
      path.relative(courseOutputRoot, entry.source).startsWith(".."),
      false,
      entry.source,
    );
  }
  assert.throws(() => publishPlan("../coach", "web"), /course/i);
  assert.throws(() => publishPlan("coach", "../ios"), /platform/i);
});

test("publish CLI accepts one full course and an optional dry-run only", async () => {
  const { parsePublishArgs } = await import("./publish.mjs");

  assert.deepEqual(parsePublishArgs(["--course", "player", "--dry-run"]), {
    course: "player",
    dryRun: true,
  });
  assert.deepEqual(parsePublishArgs(["--course", "coach"]), {
    course: "coach",
    dryRun: false,
  });
  assert.throws(() => parsePublishArgs([]), /usage:/i);
  assert.throws(() => parsePublishArgs(["--course", "../coach", "--dry-run"]), /usage:/i);
  assert.throws(() => parsePublishArgs(["--course", "coach", "--platform", "ios"]), /usage:/i);
  assert.throws(() => parsePublishArgs(["--course", "coach", "--dry-run", "extra"]), /usage:/i);
});

test("prepared publish manifests verify files and report exact immutable metadata", async () => {
  const { preparePublishManifest } = await import("./publish.mjs");
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "ponglens-publish-"));
  for (const entry of publishFixtureEntries("player", fixtureRoot)) {
    mkdirSync(path.dirname(entry.source), { recursive: true });
    writeFileSync(entry.source, `${entry.course}/${entry.slug}`);
  }

  const manifest = preparePublishManifest("player", "web", {
    root: fixtureRoot,
    verify: () => ({ id: "verified" }),
  });

  assert.equal(manifest.length, 9);
  assert.deepEqual(manifest[0], {
    course: "player",
    slug: "home",
    title: "Start here",
    source: path.join(fixtureRoot, "out", "player", "home.mp4"),
    key: "tutorial/player/home.mp4",
    size: 11,
    sha256: "b88090ee2a341c9f762d694324f0f7caed65106b48b0a4766196159ffda4c7cf",
    contentType: "video/mp4",
    cacheControl: "public, max-age=86400",
  });
});

test("a failed chapter verifier prevents creation of a publish manifest", async () => {
  const { preparePublishManifest } = await import("./publish.mjs");
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "ponglens-publish-"));
  for (const entry of publishFixtureEntries("coach", fixtureRoot)) {
    mkdirSync(path.dirname(entry.source), { recursive: true });
    writeFileSync(entry.source, `${entry.course}/${entry.slug}`);
  }

  assert.throws(
    () => preparePublishManifest("coach", "web", {
      root: fixtureRoot,
      verify: (course, slug) => {
        if (slug === "coach-audio-lesson") throw new Error(`${course}/${slug}: verification failed`);
        return { id: `${course}/${slug}` };
      },
    }),
    /coach\/coach-audio-lesson: verification failed/,
  );
});

test("publication PUTs verified bytes with fixed metadata and confirms remote size by HEAD", async () => {
  const { publishManifest } = await import("./publish.mjs");
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "ponglens-publish-"));
  const source = path.join(fixtureRoot, "out", "player", "home.mp4");
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, "player/home");
  const requests = [];

  const result = await publishManifest(
    [{
      course: "player",
      slug: "home",
      title: "Start here",
      source,
      key: "tutorial/player/home.mp4",
      size: 11,
      sha256: "b88090ee2a341c9f762d694324f0f7caed65106b48b0a4766196159ffda4c7cf",
      contentType: "video/mp4",
      cacheControl: "public, max-age=86400",
    }],
    {
      account: "test-account",
      fetch: async (url, init) => {
        requests.push({ url, init });
        if (init.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "Content-Length": "11",
              "Content-Type": "video/mp4",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
        return init.method === "GET"
          ? new Response("player/home", { status: 200 })
          : new Response(null, { status: 200 });
      },
    },
  );

  assert.deepEqual(result, { count: 1, bytes: 11 });
  assert.equal(requests.length, 3);
  assert.equal(
    requests[0].url,
    "https://test-account.r2.cloudflarestorage.com/ponglens-media/tutorial/player/home.mp4",
  );
  assert.equal(requests[0].init.method, "PUT");
  assert.equal(requests[0].init.headers["Content-Type"], "video/mp4");
  assert.equal(requests[0].init.headers["Content-Length"], "11");
  assert.equal(requests[0].init.headers["Cache-Control"], "public, max-age=86400");
  assert.equal(requests[0].init.body.toString("utf8"), "player/home");
  assert.equal(requests[1].init.method, "HEAD");
  assert.equal(requests[2].init.method, "GET");
});

test("publication rejects a changed local file, an outside key, or a HEAD size mismatch", async () => {
  const { publishManifest } = await import("./publish.mjs");
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "ponglens-publish-"));
  const source = path.join(fixtureRoot, "home.mp4");
  writeFileSync(source, "changed bytes");
  const baseEntry = {
    course: "player",
    slug: "home",
    title: "Start here",
    source,
    key: "tutorial/player/home.mp4",
    size: 11,
    sha256: "b88090ee2a341c9f762d694324f0f7caed65106b48b0a4766196159ffda4c7cf",
    contentType: "video/mp4",
    cacheControl: "public, max-age=86400",
  };
  const noNetwork = async () => {
    throw new Error("network must not be reached");
  };

  await assert.rejects(
    publishManifest([baseEntry], { account: "test-account", fetch: noNetwork }),
    /changed since verification/i,
  );
  writeFileSync(source, "player/home");
  await assert.rejects(
    publishManifest(
      [{ ...baseEntry, key: "tutorial/home.mp4" }],
      { account: "test-account", fetch: noNetwork },
    ),
    /outside the course namespace/i,
  );
  await assert.rejects(
    publishManifest(
      [{
        ...baseEntry,
        course: "../coach",
        key: "tutorial/../coach/home.mp4",
      }],
      { account: "test-account", fetch: noNetwork },
    ),
    /outside the course namespace/i,
  );
  await assert.rejects(
    publishManifest([baseEntry], {
      account: "test-account",
      fetch: async (_url, init) => init.method === "HEAD"
        ? new Response(null, { status: 200, headers: { "Content-Length": "10" } })
        : new Response(null, { status: 200 }),
    }),
    /HEAD size 10.*local size 11/i,
  );
  await assert.rejects(
    publishManifest([baseEntry], {
      account: "test-account",
      fetch: async (_url, init) => {
        if (init.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "Content-Length": "11",
              "Content-Type": "application/octet-stream",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
        return new Response(null, { status: 200 });
      },
    }),
    /HEAD content-type.*application\/octet-stream.*video\/mp4/i,
  );
  await assert.rejects(
    publishManifest([baseEntry], {
      account: "test-account",
      fetch: async (_url, init) => {
        if (init.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "Content-Length": "11",
              "Content-Type": "video/mp4",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
        return init.method === "GET"
          ? new Response("wrong bytes", { status: 200 })
          : new Response(null, { status: 200 });
      },
    }),
    /GET SHA-256.*does not match/i,
  );
});

test("dry-run prints the exact local manifest without loading R2 credentials", async () => {
  const { runPublish } = await import("./publish.mjs");
  const manifest = [{
    course: "player",
    slug: "home",
    title: "Start here",
    source: "/tmp/out/player/home.mp4",
    key: "tutorial/player/home.mp4",
    size: 11,
    sha256: "b88090ee2a341c9f762d694324f0f7caed65106b48b0a4766196159ffda4c7cf",
    contentType: "video/mp4",
    cacheControl: "public, max-age=86400",
  }];
  const output = [];

  const result = await runPublish(["--course", "player", "--dry-run"], {
    prepare: () => manifest,
    print: (line) => output.push(line),
    loadR2: () => {
      throw new Error("dry-run must not load R2 credentials");
    },
  });

  assert.deepEqual(result, { dryRun: true, manifest });
  assert.deepEqual(JSON.parse(output.join("\n")), {
    dryRun: true,
    count: 1,
    bytes: 11,
    files: manifest,
  });
});

function publishFixtureEntries(course, fixtureRoot) {
  const chapters = course === "player"
    ? ["home", "upload", "viewer", "point", "keepscore", "analysis", "export", "coach", "journal"]
    : ["coach-start", "coach-add-student", "coach-connect-account", "coach-lesson-entry", "coach-audio-lesson", "coach-share-entry", "coach-review-match", "coach-feedback", "coach-paid-review"];
  return chapters.map((slug) => ({
    course,
    slug,
    source: path.join(fixtureRoot, "out", course, `${slug}.mp4`),
  }));
}

test("chapter references accept only known courses and path-safe slugs", () => {
  assert.equal(parseChapterRef("player", "home").id, "player/home");
  assert.equal(
    parseChapterRef("coach", "coach-start").id,
    "coach/coach-start",
  );
  assert.throws(() => parseChapterRef("../coach", "home"), /course/);
  assert.throws(() => parseChapterRef("player", "../../secret"), /slug/);
  assert.throws(() => parseChapterRef("spectator", "home"), /course/);
  assert.throws(() => parseChapterRef("player", "Home"), /slug/);
});

test("chapter paths keep player and coach media in separate directories", () => {
  assert.deepEqual(chapterPaths(root, "player", "home"), {
    chapter: path.join(root, "chapters", "player", "home.json"),
    flow: path.join(root, "flows", "player", "home.mjs"),
    voice: path.join(root, "voice", "player", "home.json"),
    audio: path.join(root, "audio", "player", "home"),
    rawVideo: path.join(root, "raw", "player", "tut-home.mp4"),
    rawCues: path.join(root, "raw", "player", "tut-home.cues.json"),
    guard: path.join(root, "raw", "player", "home-guard.json"),
    output: path.join(root, "out", "player", "home.mp4"),
  });
  assert.notEqual(
    chapterPaths(root, "player", "home").output,
    chapterPaths(root, "coach", "home").output,
  );
});

test("capture accepts exactly one catalog-owned course and chapter", () => {
  assert.deepEqual(parseCaptureArgs(["player", "home"]), {
    course: "player",
    slug: "home",
  });
  assert.throws(() => parseCaptureArgs([]), /usage:/i);
  assert.throws(() => parseCaptureArgs(["spectator", "home"]), /usage:/i);
  assert.throws(() => parseCaptureArgs(["player", "not-a-chapter"]), /usage:/i);
  assert.throws(() => parseCaptureArgs(["player", "home", "extra"]), /usage:/i);
});

test("tts accepts only an optional reuse flag after a catalog chapter", () => {
  assert.deepEqual(parseTTSArgs(["coach", "coach-start", "--reuse"]), {
    course: "coach",
    slug: "coach-start",
    reuse: true,
  });
  assert.deepEqual(parseTTSArgs(["player", "upload"]), {
    course: "player",
    slug: "upload",
    reuse: false,
  });
  assert.throws(() => parseTTSArgs(["player"]), /usage:/i);
  assert.throws(() => parseTTSArgs(["invalid", "upload"]), /usage:/i);
  assert.throws(() => parseTTSArgs(["player", "unknown"]), /usage:/i);
  assert.throws(() => parseTTSArgs(["player", "upload", "extra"]), /usage:/i);
  assert.throws(() => parseTTSArgs(["player", "upload", "--unknown"]), /usage:/i);
});

test("renderer accepts exactly one catalog-owned course and chapter", () => {
  assert.deepEqual(parseRenderArgs(["coach", "coach-feedback"]), {
    course: "coach",
    slug: "coach-feedback",
  });
  assert.throws(() => parseRenderArgs(["coach"]), /usage:/i);
  assert.throws(() => parseRenderArgs(["invalid", "coach-feedback"]), /usage:/i);
  assert.throws(() => parseRenderArgs(["coach", "unknown"]), /usage:/i);
  assert.throws(() => parseRenderArgs(["coach", "coach-feedback", "extra"]), /usage:/i);
});

test("probe validates its course, account, route, and supported steps", () => {
  assert.deepEqual(
    parseProbeArgs([
      "coach",
      "coach@example.com",
      "/coaching/students",
      "click:Students",
      "wait:500",
    ]),
    {
      course: "coach",
      account: "coach@example.com",
      routePath: "/coaching/students",
      steps: ["click:Students", "wait:500"],
    },
  );
  assert.throws(() => parseProbeArgs([]), /usage:/i);
  assert.throws(
    () => parseProbeArgs(["invalid", "coach@example.com", "/coaching"]),
    /usage:/i,
  );
  assert.throws(
    () => parseProbeArgs(["coach", "coach@example.com", "/coaching", "type:X"]),
    /usage:/i,
  );
  assert.throws(
    () => parseProbeArgs(["coach", "not-an-email", "/coaching"]),
    /usage:/i,
  );
  assert.throws(
    () => parseProbeArgs(["coach", "coach@example.com", "https://example.com"]),
    /usage:/i,
  );
});

test("guard recovery accepts only a catalog-owned course and chapter", () => {
  assert.deepEqual(parseGuardArgs(["restore", "player", "keepscore"]), {
    command: "restore",
    course: "player",
    slug: "keepscore",
  });
  assert.throws(() => parseGuardArgs(["restore", "player"]), /usage:/i);
  assert.throws(() => parseGuardArgs(["restore", "invalid", "keepscore"]), /usage:/i);
  assert.throws(() => parseGuardArgs(["restore", "player", "unknown"]), /usage:/i);
  assert.throws(
    () => parseGuardArgs(["restore", "player", "keepscore", "extra"]),
    /usage:/i,
  );
});

test("media production defaults to both complete web course catalogs", () => {
  assert.equal(catalogChapters("player").length, 9);
  assert.equal(catalogChapters("coach").length, 9);
});

test("explicit platform validation excludes web-only coach media from iOS", () => {
  const coachIOS = catalogChapters("coach", "ios");

  assert.equal(coachIOS.length, 8);
  assert.equal(
    coachIOS.some(({ slug }) => slug === "coach-paid-review"),
    false,
  );
  assert.throws(() => catalogChapters("coach", "android"), /platform/);
  assert.throws(() => catalogChapters("spectator", "web"), /course/);
});

test("every catalog record has a unique course slug and catalog-owned media key", () => {
  const records = [
    ...catalogChapters("player", "web").map((chapter) => ({
      course: "player",
      chapter,
    })),
    ...catalogChapters("coach", "web").map((chapter) => ({
      course: "coach",
      chapter,
    })),
  ];
  const ids = records.map(({ course, chapter }) => `${course}/${chapter.slug}`);

  assert.equal(new Set(ids).size, ids.length);
  for (const { course, chapter } of records) {
    assert.equal(chapter.mediaKey, `tutorial/${course}/${chapter.slug}.mp4`);
  }
});

test("every namespaced player flow still imports the shared account module", async () => {
  const pipelineRoot = fileURLToPath(new URL(".", import.meta.url));
  process.env.TUTORIAL_ACCOUNT = "player@example.com";
  process.env.TUTORIAL_COACH = "coach@example.com";
  try {
    for (const chapter of catalogChapters("player")) {
      const module = await import(chapterPaths(pipelineRoot, "player", chapter.slug).flow);
      assert.equal(typeof module.flow, "function", `player/${chapter.slug}`);
    }
  } finally {
    delete process.env.TUTORIAL_ACCOUNT;
    delete process.env.TUTORIAL_COACH;
  }
});
