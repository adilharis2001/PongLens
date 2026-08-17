/** A corner in SOURCE video pixels, cyclic A_near_left, B_near_right,
 *  C_far_right, D_far_left — the same convention as the review page. */
export type Corner = readonly [number, number];

export type Verdict =
  | "correct"
  | "loose"
  | "wrong_table"
  | "no_table"
  | "unusable";

export interface HoldoutRow {
  id: string;
  match_id: string;
  frame_index: number;
  frame_time_s: number | null;
  frame_key: string;
  frame_width: number;
  frame_height: number;
  source_width: number;
  source_height: number;
  venue: string | null;
  opponent_name: string | null;
  /** Null when the detector declined rather than guessed. */
  quad: Corner[] | null;
  detail: Record<string, unknown>;
  verdict: Verdict | null;
  notes: string | null;
  reviewed_at: string | null;
}
