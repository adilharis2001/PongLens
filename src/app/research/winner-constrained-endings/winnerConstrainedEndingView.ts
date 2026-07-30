import type { EndingFamily } from "../../../lib/research/winnerConstrainedEnding.ts";
import type {
  WinnerConstrainedResearchSource,
  WinnerConstrainedScoring,
} from "./types.ts";

const FORBIDDEN_PROPOSAL_KEYS = new Set([
  "prediction",
  "predictions",
  "evidence",
  "alternatives",
  "confidence",
  "ending_family",
  "contact_count",
  "net_behavior",
]);

function inspectWithheld(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(inspectWithheld);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PROPOSAL_KEYS.has(key.toLowerCase())) {
      throw new Error(`Automatic prediction must remain withheld: ${key}`);
    }
    inspectWithheld(nested);
  }
}

function participant(value: unknown, field: string) {
  if (!value || typeof value !== "object") {
    throw new Error(`Missing scored ${field}.`);
  }
  const raw = value as Record<string, unknown>;
  if (!["user", "opponent"].includes(String(raw.player))) {
    throw new Error(`Invalid scored ${field} player.`);
  }
  if (!["near", "far"].includes(String(raw.side))) {
    throw new Error(`Invalid scored ${field} side.`);
  }
  if (!String(raw.name ?? "").trim()) {
    throw new Error(`Missing scored ${field} name.`);
  }
  return {
    player: raw.player as "user" | "opponent",
    side: raw.side as "near" | "far",
    name: String(raw.name),
  };
}

export function parseWinnerConstrainedSource(
  value: unknown,
): WinnerConstrainedResearchSource {
  if (!value || typeof value !== "object") {
    throw new Error("Missing winner-constrained source.");
  }
  const raw = value as Record<string, unknown>;
  const proposal = raw.proposal as Record<string, unknown>;
  if (!proposal || proposal.automatic_prediction_withheld !== true) {
    throw new Error("Automatic prediction is not marked withheld.");
  }
  inspectWithheld(proposal);
  const scoring = proposal.scoring as Record<string, unknown>;
  const match = proposal.match as Record<string, unknown>;
  const boundary = proposal.detected_serve_boundary as Record<string, unknown>;
  const video = proposal.video as Record<string, unknown>;
  const parsed: WinnerConstrainedResearchSource = {
    id: String(raw.id),
    source_point_idx: Number(raw.source_point_idx),
    match_label: String(raw.match_label),
    duration_s: Number(raw.duration_s),
    proposal: {
      schema_version: 1,
      match: {
        label: String(match?.label ?? raw.match_label),
        venue: String(match?.venue ?? ""),
      },
      scoring: {
        server: participant(scoring?.server, "server"),
        winner: participant(scoring?.winner, "winner"),
      },
      detected_serve_boundary: {
        available: boundary?.available === true,
      },
      automatic_prediction_withheld: true,
      video: {
        duration_s: Number(video?.duration_s ?? raw.duration_s),
        fps: Number(video?.fps),
        frame_count: Number(video?.frame_count),
      },
    },
  };
  assertPredictionWithheld(parsed);
  return parsed;
}

export function assertPredictionWithheld(
  source: WinnerConstrainedResearchSource,
): void {
  if (source.proposal.automatic_prediction_withheld !== true) {
    throw new Error("Automatic prediction must remain withheld.");
  }
  inspectWithheld(source.proposal);
}

function loser(scoring: WinnerConstrainedScoring) {
  return scoring.server.player === scoring.winner.player
    ? null
    : scoring.server;
}

export function endingExplanation(
  ending: EndingFamily,
  scoring: WinnerConstrainedScoring,
): string {
  const losingPlayer = loser(scoring);
  const loserName = losingPlayer?.name ?? "The losing player";
  switch (ending) {
    case "net":
      return `${loserName}'s final shot hit the net.`;
    case "long":
      return `${loserName}'s final shot went beyond the end of the table.`;
    case "wide":
      return `${loserName}'s final shot missed the side of the table.`;
    case "clean_winner":
      return `${scoring.winner.name} hit a shot that ${loserName} did not touch.`;
    case "missed_return":
      return `${loserName} tried to return the ball but did not make contact.`;
    case "edge":
      return "The final in-play shot clipped the table edge.";
    case "other":
      return "The point ended another way; explain it in the note.";
    case "unsure":
      return "There is not enough visible evidence to classify the ending.";
  }
}
