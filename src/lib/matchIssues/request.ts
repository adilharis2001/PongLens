import { matchIssueCancelInput, matchIssueInput } from "./input.ts";
import type {
  MatchIssue,
  MatchIssueState,
  MatchIssueSubmission,
} from "./types.ts";

type DatabaseError = { code?: string; message?: string };
type DatabaseResult<T> = { data: T | null; error: DatabaseError | null };

export type MatchIssueRequestDependencies = {
  authenticate(): Promise<string | null>;
  loadState(matchId: string): Promise<DatabaseResult<MatchIssueState>>;
  submit(
    matchId: string,
    input: MatchIssueSubmission,
  ): Promise<DatabaseResult<MatchIssue>>;
  cancel(issueId: string): Promise<DatabaseResult<MatchIssue>>;
  sendPendingEmail(issueId: string): Promise<void>;
  reportError(message: string): void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function databaseFailure(error: DatabaseError | null): Response {
  switch (error?.code) {
    case "42501":
      return json({ ok: false, code: "not_allowed" }, 403);
    case "23514":
    case "22P02":
      return json({ ok: false, code: "invalid_request" }, 400);
    case "P0001":
    case "23505":
      return json({ ok: false, code: "conflict" }, 409);
    case "P0002":
      return json({ ok: false, code: "not_found" }, 404);
    default:
      return json({ ok: false, code: "temporarily_unavailable" }, 500);
  }
}

async function requestBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleMatchIssueRequest(
  request: Request,
  matchId: string,
  dependencies: MatchIssueRequestDependencies,
): Promise<Response> {
  if (!UUID.test(matchId)) {
    return json({ ok: false, code: "invalid_request" }, 400);
  }
  if (!(await dependencies.authenticate())) {
    return json({ ok: false, code: "not_authenticated" }, 401);
  }

  if (request.method === "GET") {
    const result = await dependencies.loadState(matchId);
    if (result.error || !result.data) return databaseFailure(result.error);
    return json({ state: result.data });
  }

  if (request.method === "POST") {
    const input = matchIssueInput(await requestBody(request));
    if (!input) return json({ ok: false, code: "invalid_request" }, 400);
    const result = await dependencies.submit(matchId, input);
    if (result.error || !result.data) return databaseFailure(result.error);
    try {
      await dependencies.sendPendingEmail(result.data.id);
    } catch (error) {
      dependencies.reportError(
        `Match issue ${result.data.id} was saved but email delivery failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
    return json({ issue: result.data });
  }

  if (request.method === "DELETE") {
    const input = matchIssueCancelInput(await requestBody(request));
    if (!input) return json({ ok: false, code: "invalid_request" }, 400);
    const result = await dependencies.cancel(input.issueId);
    if (result.error || !result.data) return databaseFailure(result.error);
    return json({ issue: result.data });
  }

  return json({ ok: false, code: "method_not_allowed" }, 405);
}
