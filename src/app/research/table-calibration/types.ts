/** A corner in SOURCE video pixels. Cyclic order is always
 *  A_near_left -> B_near_right -> C_far_right -> D_far_left. */
export type Corner = readonly [number, number];
export type Quad = readonly [Corner, Corner, Corner, Corner];

export type Verdict =
  | "correct"
  | "loose"
  | "wrong_table"
  | "no_table"
  | "unusable";

export interface ProposalTrial {
  accepted: boolean;
  reason: string | null;
  confidence?: number;
  edge_support?: number;
  supported_edges?: number;
  latency_s?: number;
  corners_source: Corner[] | null;
}

export interface ProposalBlock {
  trials: ProposalTrial[];
  accepted: boolean;
  reason: string | null;
  max_drift_ratio: number | null;
  median_drift_ratio: number | null;
  corners_source: Corner[] | null;
}

export interface StoredProduction {
  ok: boolean;
  note: string | null;
  corners_source?: Corner[];
}

export interface Proposals {
  luna: ProposalBlock | null;
  /** Only present where Luna could not reach consensus — Sol is 25x the
   *  price, so it is not bought where Luna already agreed with itself. */
  sol: ProposalBlock | null;
  production: StoredProduction | null;
}

export interface CalibrationRow {
  matchId: string;
  frameKey: string;
  frameWidth: number;
  frameHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  duplicateOf: string | null;
  duplicateReason: string | null;
  proposals: Proposals;
  correctedCorners: Corner[] | null;
  verdict: Verdict | null;
  notes: string | null;
  reviewedAt: string | null;
  /** Joined from matches, for identification only. */
  opponent: string | null;
  venue: string | null;
  placementStatus: string | null;
  originalName: string | null;
}
