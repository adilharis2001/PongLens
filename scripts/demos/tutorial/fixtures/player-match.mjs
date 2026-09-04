import { execFileSync } from "node:child_process";
import { AwsClient } from "aws4fetch";

export const MATCH_ID = "efff9208-abf2-4a20-a498-18cc5a5130b3";
export const OWNER_ID = "6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4";
export const OWNER_EMAIL = "uploader-test@example.com";
export const STAGED_POINTS = [
  { id: "055ea148-4449-4370-948c-807a8e081411", idx: 1 },
  { id: "6fe132c2-55be-40ae-b328-fba2efbdadc5", idx: 2 },
  { id: "06128a30-88a3-4330-8ab5-a5c002d1b4e8", idx: 3 },
];

const RAW_BUCKET = "ponglens-raw";
const RAW_KEY = `${OWNER_ID}/tutorial-${MATCH_ID}-original.mp4`;
const RAW_PATH = `r2://${RAW_BUCKET}/${RAW_KEY}`;
const REST = "https://pdycinmyfnritemrsfjf.supabase.co/rest/v1/";

export const playerGuard = {
  kind: "player",
  ownerId: OWNER_ID,
  ownerEmail: OWNER_EMAIL,
  matchId: MATCH_ID,
  pointIds: STAGED_POINTS.map((point) => point.id),
  cleanupRawObjects: [{ bucket: RAW_BUCKET, key: RAW_KEY }],
};

export async function tutorialApi(key, resource, init = {}) {
  const response = await fetch(REST + resource, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`supabase ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

const credential = (envName, service) =>
  process.env[envName] ??
  execFileSync(
    "security",
    ["find-generic-password", "-a", "openclaw", "-s", service, "-w"],
    { encoding: "utf8" },
  ).trim();

const objectUrl = (account, bucket, key) =>
  `https://${account}.r2.cloudflarestorage.com/${bucket}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

/** Copy only the vetted demo cut to the disposable Original location. */
export async function stageOriginal(key) {
  const [match] = await tutorialApi(
    key,
    `matches?id=eq.${MATCH_ID}&select=user_id,cut_path`,
  );
  if (match?.user_id !== OWNER_ID || !match.cut_path?.startsWith("r2://ponglens-media/")) {
    throw new Error("approved player tutorial fixture is missing or changed owner");
  }
  const account = credential("R2_ACCOUNT_ID", "ponglens-r2-account");
  const client = new AwsClient({
    accessKeyId: credential("R2_ACCESS_KEY_ID", "ponglens-r2-key-id"),
    secretAccessKey: credential("R2_SECRET_ACCESS_KEY", "ponglens-r2-secret"),
    region: "auto",
    service: "s3",
  });
  const sourceKey = match.cut_path.slice("r2://ponglens-media/".length);
  const response = await client.fetch(objectUrl(account, RAW_BUCKET, RAW_KEY), {
    method: "PUT",
    headers: {
      "x-amz-copy-source": encodeURI(`/ponglens-media/${sourceKey}`),
      "Content-Type": "video/mp4",
    },
  });
  if (!response.ok) throw new Error(`R2 CopyObject failed: ${response.status}`);
  await tutorialApi(key, `matches?id=eq.${MATCH_ID}&user_id=eq.${OWNER_ID}`, {
    method: "PATCH",
    body: JSON.stringify({ raw_path: RAW_PATH }),
  });
}

/** A conservative textbook serve accepted by the shipping trust collector. */
export function stagedPlacement(point) {
  const first = `tutorial-${point.idx}-first`;
  const landing = `tutorial-${point.idx}-landing`;
  // These are the match's first three scored serve cards; its confirmed
  // rotation keeps the uploader at the near end for all three.
  const serverSide = "near";
  const firstV = serverSide === "near" ? 0.42 : 2.4;
  const landingV = serverSide === "near" ? 2.28 : 0.4;
  const ready = {
    serverSide,
    server_side: serverSide,
    status: "ready",
    confidence: 0.96,
    score: 0.96,
    reasons: [],
    hard_reasons: [],
    shots: [{
      id: `tutorial-${point.idx}-serve`,
      seq: 1,
      phase: "serve",
      hitter_side: serverSide,
      contact_t: null,
      contact: null,
      serve_first_bounce: { event_id: first, u: 0.62, v: firstV, confidence: 0.96 },
      landing: { event_id: landing, u: 0.42 + point.idx * 0.08, v: landingV, confidence: 0.96 },
      terminal: null,
      confidence: 0.96,
    }],
    used_event_ids: [first, landing],
  };
  return {
    v: 3,
    status: "ready",
    candidates: [
      { id: first, kind: "bounce", kinds: ["table_bounce"], t: 1, u: 0.62, v: firstV, x: null, y: null, visual_confidence: 0.96, audio_confidence: 0 },
      { id: landing, kind: "bounce", kinds: ["table_bounce"], t: 1.4, u: 0.42 + point.idx * 0.08, v: landingV, x: null, y: null, visual_confidence: 0.96, audio_confidence: 0 },
    ],
    hypotheses: {
      near: serverSide === "near" ? ready : { serverSide: "near", server_side: "near", status: "unavailable", confidence: 0, score: 0, reasons: [], hard_reasons: ["staging_unavailable"], shots: [], used_event_ids: [] },
      far: serverSide === "far" ? ready : { serverSide: "far", server_side: "far", status: "unavailable", confidence: 0, score: 0, reasons: [], hard_reasons: ["staging_unavailable"], shots: [], used_event_ids: [] },
    },
  };
}

/** Stage the two real surfaces named by the coach match-review narration. */
export async function stagePlayerMatch(key) {
  await stageOriginal(key);
  for (const point of STAGED_POINTS) {
    await tutorialApi(key, `points?id=eq.${point.id}&match_id=eq.${MATCH_ID}`, {
      method: "PATCH",
      body: JSON.stringify({
        placement: stagedPlacement(point),
        ...(point.idx === 1 ? { deleted: false } : {}),
      }),
    });
  }
  await tutorialApi(key, `matches?id=eq.${MATCH_ID}&user_id=eq.${OWNER_ID}`, {
    method: "PATCH",
    body: JSON.stringify({ placement_status: "ready", placement_mapped_points: 3 }),
  });
}
