/**
 * Put the landing page's video where it belongs: a PUBLIC bucket of its own.
 *
 *   node scripts/demos/landing/publish.mjs [--bucket ponglens-public] [--v v1]
 *
 * Not ponglens-media. That bucket holds every user's match clips, point
 * videos, drawn-on frames and uploaded images, and it is reachable only
 * through signed URLs (src/app/api/media-url). An R2 custom domain makes the
 * WHOLE bucket readable by anyone who can guess a key, so pointing one at
 * ponglens-media would publish other people's matches. Marketing assets get
 * their own bucket and always will.
 *
 * Keys are versioned (walkthrough/v1/...) so the objects can be served
 * immutable: the video has been re-rendered ten times and counting, and a
 * year-long cache on a name that gets reused is a landing page showing an
 * old cut to everyone who has been before. A new cut goes to v2.
 */

import { AwsClient } from "aws4fetch";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..", "..", "..");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BUCKET = arg("bucket", "ponglens-public");
const V = arg("v", "v1");

/** Credentials from .env.local, the same three the app signs with. */
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    })
);
for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
  if (!env[k]) throw new Error(`missing ${k} in .env.local`);
}

const ORIGIN = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const aws = new AwsClient({
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

const ASSETS = [
  ["public/demo/walkthrough-desktop.mp4", `walkthrough/${V}/desktop.mp4`, "video/mp4"],
  ["public/demo/walkthrough-mobile.mp4", `walkthrough/${V}/mobile.mp4`, "video/mp4"],
  ["public/demo/walkthrough-desktop.jpg", `walkthrough/${V}/desktop.jpg`, "image/jpeg"],
  ["public/demo/walkthrough-mobile.jpg", `walkthrough/${V}/mobile.jpg`, "image/jpeg"],
  ["public/demo/walkthrough.vtt", `walkthrough/${V}/captions.vtt`, "text/vtt; charset=utf-8"],
];

// The bucket, if it is not there yet. R2 answers an existing bucket with 409
// rather than an error worth stopping for.
const made = await aws.fetch(`${ORIGIN}/${BUCKET}`, { method: "PUT" });
console.log(
  made.ok
    ? `created bucket ${BUCKET}`
    : made.status === 409
      ? `bucket ${BUCKET} already there`
      : `! create bucket ${BUCKET}: ${made.status} ${(await made.text()).slice(0, 160)}`
);

for (const [rel, key, type] of ASSETS) {
  const file = path.join(ROOT, rel);
  if (!existsSync(file)) throw new Error(`missing ${rel}`);
  const body = readFileSync(file);
  const res = await aws.fetch(`${ORIGIN}/${BUCKET}/${key}`, {
    method: "PUT",
    body,
    headers: {
      "Content-Type": type,
      // A year, and never revalidated. Safe only because the key carries a
      // version — see the note at the top.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  console.log(
    `${res.ok ? "  ok  " : "  !!  "}${key}  ${(body.length / 1048576).toFixed(2)} MB` +
      (res.ok ? "" : `  ${res.status} ${(await res.text()).slice(0, 160)}`)
  );
}

console.log(
  `\nUploaded to r2://${BUCKET}/walkthrough/${V}/.\n` +
    "Public access is the one step this cannot do: an S3 key can write\n" +
    "objects but cannot attach a custom domain. Connect one to the bucket in\n" +
    "the Cloudflare dashboard, then point CUTS in LandingVideo.tsx at it."
);
