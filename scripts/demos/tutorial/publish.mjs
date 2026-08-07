/**
 * Push the rendered chapters to R2.
 *
 *   node scripts/demos/tutorial/publish.mjs
 *
 * They live at r2://ponglens-media/tutorial/<slug>.mp4 rather than in
 * public/: nine files is about 50 MB, which would ride along in every
 * Vercel deploy forever. R2 already holds every other video the app
 * serves, egress is free, and the app signs reads the same way it does
 * for clips.
 *
 * Credentials come from the macOS Keychain (account `openclaw`), the same
 * ones the worker uses.
 */

import { AwsClient } from "aws4fetch";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = "ponglens-media";
const PREFIX = "tutorial";

/** Chapter order is the product; the slug is what the app asks for. */
export const CHAPTERS = [
  { n: 1, slug: "home", title: "Start here" },
  { n: 2, slug: "upload", title: "Upload a match" },
  { n: 3, slug: "viewer", title: "Watch it back" },
  { n: 4, slug: "point", title: "Score a point" },
  { n: 5, slug: "keepscore", title: "Score Keeper" },
  { n: 6, slug: "analysis", title: "Read your match" },
  { n: 7, slug: "export", title: "Export and share" },
  { n: 8, slug: "coach", title: "You and your coach" },
  { n: 9, slug: "journal", title: "The journal" },
];

const keychain = (service) =>
  execFileSync("security", ["find-generic-password", "-a", "openclaw", "-s", service, "-w"], {
    encoding: "utf8",
  }).trim();

const account = process.env.R2_ACCOUNT_ID ?? keychain("ponglens-r2-account");
const client = new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? keychain("ponglens-r2-key-id"),
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? keychain("ponglens-r2-secret"),
  region: "auto",
  service: "s3",
});

let total = 0;
for (const ch of CHAPTERS) {
  const file = path.join(DIR, "out", `${ch.slug}-B.mp4`);
  const body = readFileSync(file);
  const size = statSync(file).size;
  const url = `https://${account}.r2.cloudflarestorage.com/${BUCKET}/${PREFIX}/${ch.slug}.mp4`;
  const res = await client.fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      // A chapter only changes when it is re-shot, and the URL is signed
      // per request anyway, so let players and CDNs hold onto it.
      "Cache-Control": "public, max-age=86400",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`PUT ${ch.slug}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  total += size;
  console.log(`  ${ch.n}. ${ch.slug.padEnd(10)} ${(size / 1048576).toFixed(1)} MB`);
}
console.log(`published ${CHAPTERS.length} chapters, ${(total / 1048576).toFixed(1)} MB total`);
