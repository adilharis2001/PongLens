import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Lifecycle RPCs raise with stable SQLSTATEs (migration 073):
 *   42501  not allowed          -> 403
 *   P0002  not found            -> 404
 *   P0001  state/config refusal -> 409, message is a stable slug
 *                                  (e.g. coach_at_capacity, bad_state)
 *   23514  invalid input        -> 400
 * Same dialect as the placement routes: the client gets { code }, never
 * database internals.
 */
export function mapRpcError(error: PostgrestError): {
  code: string;
  status: number;
} {
  switch (error.code) {
    case "P0002":
      return { code: "not_found", status: 404 };
    case "42501":
      return { code: "not_allowed", status: 403 };
    case "23514":
      return { code: "invalid_input", status: 400 };
    case "P0001": {
      const slug = /^[a-z_]+$/.test(error.message.trim())
        ? error.message.trim()
        : "bad_state";
      return { code: slug, status: 409 };
    }
    default:
      console.error("review rpc error:", error);
      return { code: "server_error", status: 500 };
  }
}
