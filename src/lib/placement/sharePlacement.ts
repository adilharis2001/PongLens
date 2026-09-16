import type {
  PlacementCandidateV3,
  PlacementEventV3,
  PlacementHypothesisV3,
  PlacementShotV3,
  Point,
} from "../types";

/**
 * A point's placement, reduced to what the match analysis deck reads.
 *
 * The public share page runs the same deck as the owner's match page, in
 * the browser, so every point's placement has to reach it. The full record
 * is 400 to 700 kB per match, most of it pixel positions, confidences and
 * per-event lists that no card looks at. This keeps the fields the four
 * consumers read and nothing else:
 *
 *   - the serve rule (placementAggregate): the serve shot's first bounce
 *     and landing, the hypothesis status / confidence / hard_reasons, and
 *     the bounce list with its ids and times, to ask whether the two
 *     bounces were consecutive;
 *   - point length (scoredCards): the first bounce inside the table;
 *   - where points ended (scoredCards): every bounce and contact with its
 *     time and table coordinates;
 *   - the rally collector, when serves-only is off: every shot's landing.
 *
 * Add a field here when a card starts reading it; the parity test compares
 * the cards computed from the slim record against the full one on a real
 * match, so a missed field fails loudly rather than drawing a thinner map.
 */
export function slimPlacementForShare(
  placement: Point["placement"],
  servesOnly: boolean,
): Point["placement"] {
  if (!placement || !("v" in placement) || placement.v !== 3) {
    return placement ?? null;
  }
  const event = (e: PlacementEventV3 | null | undefined): PlacementEventV3 | null =>
    e
      ? {
          event_id: e.event_id ?? null,
          ...(typeof e.t === "number" ? { t: e.t } : {}),
          ...(typeof e.u === "number" ? { u: e.u } : {}),
          ...(typeof e.v === "number" ? { v: e.v } : {}),
          confidence: e.confidence,
        }
      : null;
  const shot = (s: PlacementShotV3): PlacementShotV3 => ({
    id: s.id,
    seq: s.seq,
    phase: s.phase,
    hitter_side: s.hitter_side,
    contact_t: s.contact_t ?? null,
    contact: null,
    serve_first_bounce: event(s.serve_first_bounce),
    landing: event(s.landing),
    terminal: null,
    confidence: s.confidence,
  });
  const hypothesis = (h: PlacementHypothesisV3): PlacementHypothesisV3 => ({
    serverSide: h.serverSide ?? h.server_side,
    server_side: h.server_side ?? h.serverSide,
    status: h.status,
    confidence: h.confidence,
    score: h.score,
    reasons: [],
    hard_reasons: h.hard_reasons ?? [],
    used_event_ids: [],
    shots: (h.shots ?? [])
      .filter((s) => !servesOnly || s.phase === "serve")
      .map(shot),
  });
  const candidates: PlacementCandidateV3[] = Array.isArray(placement.candidates)
    ? placement.candidates
        .filter((c) => c.kind === "bounce" || c.kind === "contact")
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          kinds: [],
          t: c.t,
          ...(typeof c.u === "number" ? { u: c.u } : {}),
          ...(typeof c.v === "number" ? { v: c.v } : {}),
          visual_confidence: 0,
          audio_confidence: 0,
        }))
    : [];
  return {
    v: 3,
    status: placement.status,
    candidates,
    hypotheses: {
      near: hypothesis(placement.hypotheses.near),
      far: hypothesis(placement.hypotheses.far),
    },
  };
}
