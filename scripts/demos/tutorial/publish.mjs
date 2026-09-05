/**
 * Verify and publish rendered tutorial chapters to R2.
 *
 *   node --experimental-strip-types scripts/demos/tutorial/publish.mjs --course player --dry-run
 *
 * The catalog supplies every local source and remote key. Player files live
 * under tutorial/player/ and coach files under tutorial/coach/, never in
 * public/. Dry-run verifies the rendered files and prints exact sizes and
 * SHA-256 digests without loading credentials or making a network request.
 *
 * A non-dry run loads credentials from the macOS Keychain (account
 * `openclaw`), uploads with fixed media metadata, then confirms each remote
 * Content-Length with HEAD.
 */

import { AwsClient } from "aws4fetch";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { catalogChapter, catalogChapters, chapterPaths } from "./course-paths.mjs";
import { verifyChapter } from "./verify.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = "ponglens-media";
const USAGE = "usage: publish.mjs --course <player|coach> [--dry-run]";
export const CONTENT_TYPE = "video/mp4";
export const CACHE_CONTROL = "public, max-age=86400";

export function publishPlan(course, platform = "web", { root = DIR } = {}) {
  return catalogChapters(course, platform).map((chapter) => ({
    course,
    slug: chapter.slug,
    title: chapter.title,
    source: path.resolve(chapterPaths(root, course, chapter.slug).output),
    key: chapter.mediaKey,
  }));
}

export function parsePublishArgs(args) {
  const dryRun = args.at(-1) === "--dry-run";
  const core = dryRun ? args.slice(0, -1) : args;
  if (
    core.length !== 2 ||
    core[0] !== "--course" ||
    !["player", "coach"].includes(core[1])
  ) {
    throw new Error(USAGE);
  }
  return { course: core[1], dryRun };
}

export function preparePublishManifest(
  course,
  platform = "web",
  { root = DIR, verify = verifyChapter } = {},
) {
  return publishPlan(course, platform, { root }).map((entry) => {
    verify(entry.course, entry.slug, { root });
    const stat = statSync(entry.source);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(`${entry.course}/${entry.slug}: output must be a non-empty file`);
    }
    return {
      ...entry,
      size: stat.size,
      sha256: createHash("sha256").update(readFileSync(entry.source)).digest("hex"),
      contentType: CONTENT_TYPE,
      cacheControl: CACHE_CONTROL,
    };
  });
}

export async function publishManifest(manifest, { account, fetch }) {
  let bytes = 0;
  for (const entry of manifest) {
    let catalog;
    try {
      catalog = catalogChapter(entry.course, entry.slug, "web");
    } catch {
      throw new Error(`${entry.key}: outside the course namespace`);
    }
    if (entry.key !== catalog.mediaKey) {
      throw new Error(`${entry.key}: outside the course namespace`);
    }
    if (entry.contentType !== CONTENT_TYPE || entry.cacheControl !== CACHE_CONTROL) {
      throw new Error(`${entry.course}/${entry.slug}: unexpected publish metadata`);
    }

    const body = readFileSync(entry.source);
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (body.length !== entry.size || sha256 !== entry.sha256) {
      throw new Error(`${entry.course}/${entry.slug}: output changed since verification`);
    }

    const url = `https://${account}.r2.cloudflarestorage.com/${BUCKET}/${entry.key}`;
    const put = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": entry.contentType,
        "Content-Length": String(entry.size),
        "Cache-Control": entry.cacheControl,
      },
      body,
    });
    if (!put.ok) {
      throw new Error(`PUT ${entry.key}: ${put.status} ${(await put.text()).slice(0, 200)}`);
    }

    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) {
      throw new Error(`HEAD ${entry.key}: ${head.status} ${(await head.text()).slice(0, 200)}`);
    }
    const remoteSize = Number(head.headers.get("content-length"));
    if (remoteSize !== entry.size) {
      throw new Error(
        `${entry.key}: HEAD size ${String(remoteSize)} does not match local size ${entry.size}`,
      );
    }
    bytes += entry.size;
  }
  return { count: manifest.length, bytes };
}

const keychain = (service) =>
  execFileSync("security", ["find-generic-password", "-a", "openclaw", "-s", service, "-w"], {
    encoding: "utf8",
  }).trim();

function loadR2() {
  const account = process.env.R2_ACCOUNT_ID ?? keychain("ponglens-r2-account");
  const client = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? keychain("ponglens-r2-key-id"),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? keychain("ponglens-r2-secret"),
    region: "auto",
    service: "s3",
  });
  return { account, fetch: client.fetch.bind(client) };
}

export async function runPublish(
  args,
  {
    root = DIR,
    prepare = preparePublishManifest,
    print = console.log,
    loadR2: loadTransport = loadR2,
    publish = publishManifest,
  } = {},
) {
  const { course, dryRun } = parsePublishArgs(args);
  const manifest = prepare(course, "web", { root });
  const bytes = manifest.reduce((sum, entry) => sum + entry.size, 0);
  if (dryRun) {
    print(JSON.stringify({ dryRun: true, count: manifest.length, bytes, files: manifest }, null, 2));
    return { dryRun: true, manifest };
  }

  const result = await publish(manifest, loadTransport());
  print(`published ${result.count} chapters, ${(result.bytes / 1048576).toFixed(1)} MB total`);
  return { dryRun: false, manifest, ...result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPublish(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
