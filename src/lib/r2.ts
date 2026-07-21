import "server-only";
import { AwsClient } from "aws4fetch";

/**
 * Cloudflare R2 helpers (S3-compatible API, region "auto").
 *
 * Server-only: uses the R2 access key, which must never reach the browser.
 * The browser only ever sees short-lived presigned URLs minted here.
 *
 * Buckets:
 *   ponglens-raw    raw user uploads   (retention: 7 days, worker sweeps)
 *   ponglens-media  processed results  (results/: 30 days, worker sweeps)
 */

export const RAW_BUCKET = "ponglens-raw";
export const MEDIA_BUCKET = "ponglens-media";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function endpoint(): string {
  return `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
}

function client(): AwsClient {
  return new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    region: "auto",
    service: "s3",
  });
}

function objectUrl(bucket: string, key: string): URL {
  // Encode each path segment but keep the slashes.
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return new URL(`${endpoint()}/${bucket}/${encoded}`);
}

async function presign(
  url: URL,
  method: string,
  expiresSeconds: number
): Promise<string> {
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await client().sign(
    new Request(url.toString(), { method }),
    { aws: { signQuery: true } }
  );
  return signed.url;
}

/** Presigned simple PUT (files small enough for a single request). */
export function presignPut(
  bucket: string,
  key: string,
  expiresSeconds = 6 * 3600
): Promise<string> {
  return presign(objectUrl(bucket, key), "PUT", expiresSeconds);
}

/**
 * Presigned GET. `filename` sets Content-Disposition on the response.
 * `disposition: "inline"` streams in-page (e.g. <video> point clips).
 */
export function presignGet(
  bucket: string,
  key: string,
  opts: {
    expiresSeconds?: number;
    filename?: string;
    disposition?: "attachment" | "inline";
  } = {}
): Promise<string> {
  const url = objectUrl(bucket, key);
  const disposition = opts.disposition ?? (opts.filename ? "attachment" : undefined);
  if (disposition) {
    const name = opts.filename
      ? `; filename="${opts.filename.replace(/["\\]/g, "")}"`
      : "";
    url.searchParams.set(
      "response-content-disposition",
      `${disposition}${name}`
    );
  }
  return presign(url, "GET", opts.expiresSeconds ?? 3600);
}

/** Server-side PUT of a small object (e.g. voice note audio). */
export async function putObject(
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  const res = await client().fetch(objectUrl(bucket, key).toString(), {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
    },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 PutObject ${res.status}: ${text.slice(0, 300)}`);
  }
}

/** Start a multipart upload; returns the R2 uploadId. */
export async function createMultipartUpload(
  bucket: string,
  key: string,
  contentType = "video/mp4"
): Promise<string> {
  const url = objectUrl(bucket, key);
  url.searchParams.set("uploads", "");
  const res = await client().fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": contentType },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`R2 CreateMultipartUpload ${res.status}: ${body.slice(0, 300)}`);
  }
  const m = body.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!m) throw new Error("R2 CreateMultipartUpload: no UploadId in response");
  return m[1];
}

/** Presigned URL for one part of a multipart upload. */
export function presignUploadPart(
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  expiresSeconds = 6 * 3600
): Promise<string> {
  const url = objectUrl(bucket, key);
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  return presign(url, "PUT", expiresSeconds);
}

export async function completeMultipartUpload(
  bucket: string,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[]
): Promise<void> {
  const url = objectUrl(bucket, key);
  url.searchParams.set("uploadId", uploadId);
  const xml =
    "<CompleteMultipartUpload>" +
    parts
      .slice()
      .sort((a, b) => a.partNumber - b.partNumber)
      .map(
        (p) =>
          `<Part><PartNumber>${p.partNumber}</PartNumber>` +
          `<ETag>${p.etag.replace(/[<>&]/g, "")}</ETag></Part>`
      )
      .join("") +
    "</CompleteMultipartUpload>";
  const res = await client().fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });
  const body = await res.text();
  // S3-style APIs can return 200 with an <Error> body on complete.
  if (!res.ok || body.includes("<Error>")) {
    throw new Error(`R2 CompleteMultipartUpload failed: ${body.slice(0, 300)}`);
  }
}

export async function abortMultipartUpload(
  bucket: string,
  key: string,
  uploadId: string
): Promise<void> {
  const url = objectUrl(bucket, key);
  url.searchParams.set("uploadId", uploadId);
  const res = await client().fetch(url.toString(), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 AbortMultipartUpload ${res.status}`);
  }
}
