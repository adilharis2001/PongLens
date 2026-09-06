import type { BetaAnswers } from "./questionnaire";

export type BetaSignupResult =
  | "success"
  | "invalid_email"
  | "invalid_answers"
  | "rate_limited"
  | "unavailable";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function submitBetaSignup(
  email: string,
  company: string,
  request: FetchLike = fetch,
  answers?: BetaAnswers,
): Promise<BetaSignupResult> {
  try {
    const response = await request("/api/ios-beta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, company, ...(answers ? { answers } : {}) }),
    });
    const body = (await response.json()) as { ok?: unknown; code?: unknown };
    if (response.ok && body.ok === true) return "success";
    if (body.code === "invalid_email") return "invalid_email";
    if (body.code === "invalid_answers") return "invalid_answers";
    if (body.code === "rate_limited") return "rate_limited";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
