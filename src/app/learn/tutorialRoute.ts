import {
  resolveLegacyTutorialRequest,
  resolveTutorialRequest,
  type TutorialMediaSelection,
} from "./tutorialRequest.ts";

interface TutorialRouteUser {
  id: string;
}

interface TutorialSignRequest {
  key: string;
  disposition: "inline";
  expiresSeconds: number;
}

export interface TutorialRouteDependencies {
  getUser: () => Promise<TutorialRouteUser | null>;
  sign: (items: TutorialSignRequest[]) => Promise<string[]>;
}

const INVALID_REQUEST = { error: "Invalid course or platform" };
const UNKNOWN_CHAPTER = { error: "Unknown chapter" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function allowedKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

type ParsedRequest =
  | { kind: "invalid" }
  | { kind: "legacy"; wanted: readonly TutorialMediaSelection[] }
  | { kind: "current"; wanted: readonly TutorialMediaSelection[] | null };

async function parseTutorialRequest(request: Request): Promise<ParsedRequest> {
  const raw = await request.text();
  if (raw.trim() === "") {
    return { kind: "legacy", wanted: resolveLegacyTutorialRequest() };
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (!isRecord(input)) return { kind: "invalid" };

  const keys = Object.keys(input);
  if (keys.length === 0) {
    return { kind: "legacy", wanted: resolveLegacyTutorialRequest() };
  }

  const hasCourse = hasOwn(input, "course");
  const hasPlatform = hasOwn(input, "platform");
  if (hasCourse || hasPlatform) {
    if (
      !hasCourse ||
      !hasPlatform ||
      !allowedKeys(input, ["course", "platform", "slug"]) ||
      (hasOwn(input, "slug") && typeof input.slug !== "string")
    ) {
      return { kind: "invalid" };
    }
    return {
      kind: "current",
      wanted: resolveTutorialRequest({
        course: input.course,
        platform: input.platform,
        slug: input.slug,
      }),
    };
  }

  if (
    keys.length === 1 &&
    hasOwn(input, "slug") &&
    typeof input.slug === "string"
  ) {
    return {
      kind: "legacy",
      wanted: resolveLegacyTutorialRequest(input.slug),
    };
  }

  return { kind: "invalid" };
}

/**
 * The route contract separated from Next and storage adapters so requests,
 * validation, authentication, signing selection, and response bodies are
 * exercised together in the Node test suite.
 */
export async function handleTutorialURLRequest(
  request: Request,
  dependencies: TutorialRouteDependencies,
): Promise<Response> {
  if (!(await dependencies.getUser())) {
    return json({ error: "Not signed in" }, 401);
  }

  const parsed = await parseTutorialRequest(request);
  if (parsed.kind === "invalid" || parsed.wanted === null) {
    return json(INVALID_REQUEST, 400);
  }
  if (parsed.wanted.length === 0) {
    return json(UNKNOWN_CHAPTER, 404);
  }

  const urls = await dependencies.sign(
    parsed.wanted.map(({ mediaKey }) => ({
      key: mediaKey,
      disposition: "inline",
      expiresSeconds: 6 * 3600,
    })),
  );

  return json({
    urls: Object.fromEntries(
      parsed.wanted.map((chapter, index) => [chapter.slug, urls[index]]),
    ),
  });
}
